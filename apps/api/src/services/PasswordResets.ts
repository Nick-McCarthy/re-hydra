import { createHash, randomBytes } from "node:crypto"
import { Config, Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { hashPassword } from "../auth/password.js"
import { ResetRejected } from "../domain/Auth.js"
import { passwordResetEmailRule } from "../http/rateLimit.js"
import { Mailer } from "./Mailer.js"
import { RateLimits } from "./RateLimits.js"

const hashToken = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest()

/** A reset link is good for this long, once. */
const TOKEN_TTL_MINUTES = 60

/**
 * Forgotten passwords.
 *
 * - `request(email)` always succeeds the same way, so the endpoint does not
 *   reveal which emails have accounts. When one does, any unused token is
 *   retired, a new one is stored (hashed), and the link is mailed. Mailing
 *   runs detached, so the response time does not depend on it either.
 * - `confirm(token, password)` sets the password, uses the token, and ends
 *   every session for that user. It also works for an account that never had
 *   a password (created before migration 010). Access tokens stay, as with a
 *   password change; the account page lists and revokes them.
 */
export class PasswordResets extends Context.Service<
  PasswordResets,
  {
    readonly request: (email: string) => Effect.Effect<void>
    readonly confirm: (token: string, newPassword: string) => Effect.Effect<void, ResetRejected>
  }
>()("rehydra/services/PasswordResets") {
  static readonly layer = Layer.effect(
    PasswordResets,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const mailer = yield* Mailer
      const limits = yield* RateLimits
      const appUrl = (yield* Config.String("APP_URL").pipe(Config.withDefault("http://localhost:5173"))).replace(/\/+$/, "")

      const request = Effect.fn("PasswordResets.request")(function*(rawEmail: string) {
        const email = rawEmail.trim().toLowerCase()
        // Per address, on top of the per-client route limit, so one inbox
        // cannot be flooded from many clients.
        const taken = limits.take(`password-reset-email:${email}`, passwordResetEmailRule.limit, passwordResetEmailRule.windowMs)
        if (!taken.ok) return
        const users = yield* sql<{ readonly id: string; readonly display_name: string }>`
          SELECT id, display_name FROM users WHERE email = ${email} LIMIT 1
        `.pipe(Effect.orDie)
        const user = users[0]
        if (user === undefined) return
        const token = randomBytes(32).toString("base64url")
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`
            UPDATE password_resets SET used_at = now()
            WHERE user_id = ${user.id} AND used_at IS NULL
          `
          yield* sql`
            INSERT INTO password_resets (user_id, token_hash, expires_at)
            VALUES (${user.id}, ${hashToken(token)}, now() + make_interval(mins => ${TOKEN_TTL_MINUTES}))
          `
        })).pipe(Effect.orDie)
        const link = `${appUrl}/reset-password#token=${token}`
        yield* mailer.send({
          to: email,
          subject: "Reset your re-hydra password",
          text: [
            `Hi ${user.display_name},`,
            "",
            "Someone asked to reset the password for your re-hydra account. To choose a new one, open this link within an hour:",
            "",
            link,
            "",
            "If you did not ask, ignore this email. Your password stays the same."
          ].join("\n")
        }).pipe(
          Effect.catchTag("MailFailed", (error) => Effect.logError("password reset email failed", error.cause)),
          Effect.forkDetach
        )
      })

      const confirm = Effect.fn("PasswordResets.confirm")(function*(token: string, newPassword: string) {
        const passwordHash = yield* hashPassword(newPassword).pipe(Effect.orDie)
        const done = yield* sql.withTransaction(Effect.gen(function*() {
          const rows = yield* sql<{ readonly id: string; readonly user_id: string }>`
            SELECT id, user_id FROM password_resets
            WHERE token_hash = ${hashToken(token)} AND used_at IS NULL AND expires_at > now()
            FOR UPDATE
          `
          const reset = rows[0]
          if (reset === undefined) return false
          yield* sql`UPDATE password_resets SET used_at = now() WHERE id = ${reset.id}`
          yield* sql`UPDATE users SET password_hash = ${passwordHash} WHERE id = ${reset.user_id}`
          yield* sql`
            UPDATE sessions SET revoked_at = now()
            WHERE user_id = ${reset.user_id} AND revoked_at IS NULL
          `
          return true
        })).pipe(Effect.orDie)
        if (!done) {
          return yield* new ResetRejected({
            detail: "This reset link is invalid, used, or older than an hour. Ask for a new one."
          })
        }
      })

      return PasswordResets.of({ request, confirm })
    })
  )
}
