import { createHash, createHmac } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Config, Context, Data, Effect, Layer, Redacted } from "effect"

export type Mail = {
  readonly to: string
  readonly subject: string
  readonly text: string
}

export class MailFailed extends Data.TaggedError("MailFailed")<{ readonly cause: unknown }> {}

/**
 * Outgoing email. `MAIL_DRIVER` picks the transport:
 *
 * - `log` (default): writes the message to the API log. Local only. A reset
 *   link in a log is a credential, so the API warns at startup.
 * - `file`: writes each message as JSON under `MAIL_DIR` (default `.mail`).
 *   Local development and the verify scripts read it from there.
 * - `ses`: Amazon SES v2 `SendEmail`, signed with SigV4. Needs `MAIL_FROM`
 *   (a verified sender), `SES_ACCESS_KEY`, `SES_SECRET_KEY`, and optionally
 *   `SES_REGION` (default us-east-1).
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    readonly driver: "log" | "file" | "ses"
    readonly send: (mail: Mail) => Effect.Effect<void, MailFailed>
  }
>()("rehydra/services/Mailer") {
  static readonly layer = Layer.effect(
    Mailer,
    Effect.gen(function*() {
      const driver = yield* Config.Literals(["log", "file", "ses"], "MAIL_DRIVER").pipe(Config.withDefault("log" as const))
      const from = yield* Config.String("MAIL_FROM").pipe(Config.withDefault("re-hydra <no-reply@localhost>"))

      if (driver === "log") {
        yield* Effect.logWarning("MAIL_DRIVER=log: emails, including password reset links, go to the log. Do not deploy with this.")
        return Mailer.of({
          driver,
          send: (mail) => Effect.logInfo(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`)
        })
      }

      if (driver === "file") {
        const dir = yield* Config.String("MAIL_DIR").pipe(Config.withDefault(".mail"))
        yield* Effect.logWarning(`MAIL_DRIVER=file: emails are written to ${path.resolve(dir)}. Do not deploy with this.`)
        return Mailer.of({
          driver,
          send: (mail) =>
            Effect.tryPromise({
              try: async () => {
                await mkdir(dir, { recursive: true })
                const name = `${Date.now()}-${createHash("sha256").update(mail.to).digest("hex").slice(0, 8)}.json`
                await writeFile(path.join(dir, name), JSON.stringify({ from, ...mail, sentAt: new Date().toISOString() }, null, 2))
              },
              catch: (cause) => new MailFailed({ cause })
            })
        })
      }

      const region = yield* Config.String("SES_REGION").pipe(Config.withDefault("us-east-1"))
      const accessKey = yield* Config.String("SES_ACCESS_KEY")
      const secretKey = yield* Config.Redacted("SES_SECRET_KEY")
      return Mailer.of({
        driver,
        send: (mail) =>
          Effect.tryPromise({
            try: async () => {
              const body = JSON.stringify({
                FromEmailAddress: from,
                Destination: { ToAddresses: [mail.to] },
                Content: {
                  Simple: {
                    Subject: { Data: mail.subject, Charset: "UTF-8" },
                    Body: { Text: { Data: mail.text, Charset: "UTF-8" } }
                  }
                }
              })
              const url = new URL(`https://email.${region}.amazonaws.com/v2/email/outbound-emails`)
              const headers = signSesRequest({ region, accessKey, secretKey }, url, body, new Date())
              const res = await fetch(url, { method: "POST", headers, body })
              if (!res.ok) throw new Error(`SES ${res.status}: ${(await res.text()).slice(0, 500)}`)
            },
            catch: (cause) => new MailFailed({ cause })
          })
      })
    })
  )
}

const sha256Hex = (data: string): string => createHash("sha256").update(data, "utf8").digest("hex")
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest()

/** AWS Signature Version 4 for a JSON POST to SES. Exported for the unit test. */
export const signSesRequest = (
  credentials: { readonly region: string; readonly accessKey: string; readonly secretKey: Redacted.Redacted },
  url: URL,
  body: string,
  now: Date
): Record<string, string> => {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  const date = stamp.slice(0, 8)
  const payloadHash = sha256Hex(body)
  const contentType = "application/json"
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date"
  const canonical = [
    "POST",
    url.pathname,
    "",
    `content-type:${contentType}\nhost:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${stamp}\n`,
    signedHeaders,
    payloadHash
  ].join("\n")
  const scope = `${date}/${credentials.region}/ses/aws4_request`
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonical)].join("\n")
  const key = hmac(
    hmac(hmac(hmac(`AWS4${Redacted.value(credentials.secretKey)}`, date), credentials.region), "ses"),
    "aws4_request"
  )
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex")
  return {
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": stamp,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  }
}
