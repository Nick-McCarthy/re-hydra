import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { Data, Effect, Redacted } from "effect"

export type S3ObjectConfig = {
  readonly endpoint: string
  readonly bucket: string
  readonly accessKey: string
  readonly secretKey: Redacted.Redacted
  readonly region: string
}

class ObjectRequestError extends Data.TaggedError("ObjectRequestError")<{
  readonly cause: unknown
}> {}

const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex")

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest()

const amzTimestamp = (now: Date): { readonly date: string; readonly stamp: string } => {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "")
  return { stamp, date: stamp.slice(0, 8) }
}

const encodePath = (path: string): string =>
  path.split("/").map((part) => encodeURIComponent(part)).join("/")

const signedHeaders = (contentType: string | undefined): string =>
  contentType === undefined
    ? "host;x-amz-content-sha256;x-amz-date"
    : "content-type;host;x-amz-content-sha256;x-amz-date"

const authorization = (
  config: S3ObjectConfig,
  method: string,
  url: URL,
  payloadHash: string,
  contentType: string | undefined,
  now: Date
): { readonly authorization: string; readonly stamp: string; readonly payloadHash: string } => {
  const time = amzTimestamp(now)
  const headers = signedHeaders(contentType)
  const canonicalHeaders = [
    ...(contentType === undefined ? [] : [`content-type:${contentType}`]),
    `host:${url.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${time.stamp}`
  ].join("\n")
  const canonical = [
    method,
    encodePath(url.pathname),
    "",
    `${canonicalHeaders}\n`,
    headers,
    payloadHash
  ].join("\n")
  const scope = `${time.date}/${config.region}/s3/aws4_request`
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    time.stamp,
    scope,
    sha256Hex(canonical)
  ].join("\n")
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${Redacted.value(config.secretKey)}`, time.date), config.region), "s3"),
    "aws4_request"
  )
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex")
  return {
    stamp: time.stamp,
    payloadHash,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${headers}, Signature=${signature}`
  }
}

const objectUrl = (config: S3ObjectConfig, key: string): URL => {
  const base = config.endpoint.endsWith("/") ? config.endpoint : `${config.endpoint}/`
  return new URL(`${config.bucket}/${key}`, base)
}

const send = (
  config: S3ObjectConfig,
  method: string,
  key: string,
  body: Uint8Array | undefined,
  contentType: string | undefined
) =>
  Effect.tryPromise({
    try: async () => {
      const url = objectUrl(config, key)
      const payloadHash = body === undefined ? emptyHash : sha256Hex(body)
      const signed = authorization(config, method, url, payloadHash, contentType, new Date())
      const headers = new Headers()
      if (contentType !== undefined) headers.set("content-type", contentType)
      headers.set("x-amz-content-sha256", signed.payloadHash)
      headers.set("x-amz-date", signed.stamp)
      headers.set("authorization", signed.authorization)
      const init: RequestInit = { method, headers }
      if (body !== undefined) init.body = Buffer.from(body)
      const response = await fetch(url, init)
      const payload = response.status === 404
        ? undefined
        : new Uint8Array(await response.arrayBuffer())
      return { status: response.status, ok: response.ok, payload }
    },
    catch: (cause) => new ObjectRequestError({ cause })
  })

export const putObject = (config: S3ObjectConfig, key: string, bytes: Uint8Array, contentType: string) =>
  Effect.gen(function*() {
    const response = yield* send(config, "PUT", key, bytes, contentType)
    if (!response.ok) {
      const detail = Buffer.from(response.payload ?? new Uint8Array()).toString("utf8")
      return yield* Effect.die(`object put failed (${response.status}) ${detail}`)
    }
  })

export const getObject = (config: S3ObjectConfig, key: string) =>
  Effect.gen(function*() {
    const response = yield* send(config, "GET", key, undefined, undefined)
    if (response.status === 404) return undefined
    if (!response.ok || response.payload === undefined) {
      const detail = Buffer.from(response.payload ?? new Uint8Array()).toString("utf8")
      return yield* Effect.die(`object get failed (${response.status}) ${detail}`)
    }
    return response.payload
  })

export const hashMatches = (bytes: Uint8Array, sha256: Uint8Array): boolean => {
  const actual = createHash("sha256").update(bytes).digest()
  return actual.byteLength === sha256.byteLength && timingSafeEqual(actual, sha256)
}
