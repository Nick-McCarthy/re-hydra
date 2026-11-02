import { createHash, randomBytes, randomUUID } from "node:crypto"
import { Config, Context, Effect, Layer, Option } from "effect"
import { Unauthorized } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type {
  ConsumeMagicLinkPayload,
  RequestMagicLinkPayload,
  SessionResponse,
  UserProfile
} from "../domain/Auth.js"
import { Mailer } from "./Mailer.js"

const hashToken = (token: string): Buffer =>
  createHash("sha256").update(token, "utf8").digest()

const newToken = (): string => randomBytes(32).toString("base64url")

type UserRow = {
  readonly id: string
  readonly email: string
  readonly display_name: string
}

type SessionRow = {
  readonly id: string
  readonly user_id: string
  readonly email: string
  readonly display_name: string
}

const toProfile = (row: UserRow): UserProfile => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name
})

export class AuthRepo extends Context.Service<
  AuthRepo,
  {
    readonly requestMagicLink: (
      payload: RequestMagicLinkPayload
    ) => Effect.Effect<{ readonly ok: true; readonly devToken?: string }>
    readonly consumeMagicLink: (
      payload: ConsumeMagicLinkPayload
    ) => Effect.Effect<SessionResponse, Unauthorized>
    readonly findUserBySessionToken: (
      token: string
    ) => Effect.Effect<Option.Option<UserProfile>>
    readonly revokeSessionByToken: (token: string) => Effect.Effect<void>
  }
>()("rehydra/services/AuthRepo") {
  static readonly layer = Layer.effect(
    AuthRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const mailer = yield* Mailer
      const publicApiUrl = yield* Config.String("PUBLIC_API_URL").pipe(
        Config.withDefault("http://localhost:3000")
      )
      const exposeDevToken = yield* Config.Boolean("AUTH_EXPOSE_DEV_TOKEN").pipe(
        Config.withDefault(true)
      )
      const magicLinkTtlMinutes = 15
      const sessionTtlDays = 30

      const requestMagicLink = Effect.fn("AuthRepo.requestMagicLink")(
        function*(payload: RequestMagicLinkPayload) {
          const email = payload.email.trim().toLowerCase()
          const token = newToken()
          const tokenHash = hashToken(token)
          const expiresAt = new Date(
            Date.now() + magicLinkTtlMinutes * 60_000
          )

          const existing = yield* sql<UserRow>`
            SELECT id, email, display_name
            FROM users
            WHERE email = ${email}
            LIMIT 1
          `

          const displayName =
            payload.displayName?.trim() ||
            existing[0]?.display_name ||
            email.split("@")[0] ||
            "user"

          let userId = existing[0]?.id
          if (userId === undefined) {
            userId = randomUUID()
            yield* sql`
              INSERT INTO users (id, email, display_name)
              VALUES (${userId}, ${email}, ${displayName})
            `
          }

          yield* sql`
            INSERT INTO magic_link_tokens (user_id, email, token_hash, expires_at)
            VALUES (${userId}, ${email}, ${tokenHash}, ${expiresAt})
          `

          const consumeUrl =
            `${publicApiUrl.replace(/\/$/, "")}/v1/auth/magic-link/consume`

          yield* mailer.sendMagicLink({ email, token, consumeUrl })

          if (exposeDevToken) {
            return { ok: true as const, devToken: token }
          }
          return { ok: true as const }
        },
        Effect.orDie
      )

      const consumeMagicLink = Effect.fn("AuthRepo.consumeMagicLink")(
        function*(payload: ConsumeMagicLinkPayload) {
          const tokenHash = hashToken(payload.token)

          return yield* sql.withTransaction(Effect.gen(function*() {
            const rows = yield* sql<{
              readonly id: string
              readonly email: string
              readonly user_id: string | null
            }>`
              SELECT id, email, user_id
              FROM magic_link_tokens
              WHERE token_hash = ${tokenHash}
                AND consumed_at IS NULL
                AND expires_at > now()
              LIMIT 1
              FOR UPDATE
            `

            const row = rows[0]
            if (row === undefined) {
              return yield* new Unauthorized()
            }

            yield* sql`
              UPDATE magic_link_tokens
              SET consumed_at = now()
              WHERE id = ${row.id}
            `

            let userId = row.user_id
            if (userId === null) {
              const users = yield* sql<UserRow>`
                SELECT id, email, display_name
                FROM users
                WHERE email = ${row.email}
                LIMIT 1
              `
              const existing = users[0]
              if (existing === undefined) {
                userId = randomUUID()
                const name = row.email.split("@")[0] || "user"
                yield* sql`
                  INSERT INTO users (id, email, display_name)
                  VALUES (${userId}, ${row.email}, ${name})
                `
              } else {
                userId = existing.id
              }
            }

            yield* sql`
              UPDATE users SET last_seen_at = now() WHERE id = ${userId}
            `

            const sessionToken = newToken()
            const sessionHash = hashToken(sessionToken)
            const expiresAt = new Date(
              Date.now() + sessionTtlDays * 24 * 60 * 60_000
            )

            yield* sql`
              INSERT INTO sessions (user_id, token_hash, expires_at)
              VALUES (${userId}, ${sessionHash}, ${expiresAt})
            `

            const users = yield* sql<UserRow>`
              SELECT id, email, display_name
              FROM users
              WHERE id = ${userId}
              LIMIT 1
            `
            const user = users[0]
            if (user === undefined) {
              return yield* new Unauthorized()
            }

            return {
              token: sessionToken,
              expiresAt: expiresAt.toISOString(),
              user: toProfile(user)
            } satisfies SessionResponse
          })).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)))
        }
      )

      const findUserBySessionToken = Effect.fn("AuthRepo.findUserBySessionToken")(
        function*(token: string) {
          const tokenHash = hashToken(token)
          const rows = yield* sql<SessionRow>`
            SELECT
              s.id,
              s.user_id,
              u.email,
              u.display_name
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ${tokenHash}
              AND s.revoked_at IS NULL
              AND s.expires_at > now()
            LIMIT 1
          `
          const row = rows[0]
          if (row === undefined) {
            return Option.none()
          }

          yield* sql`
            UPDATE sessions SET last_used_at = now() WHERE id = ${row.id}
          `
          yield* sql`
            UPDATE users SET last_seen_at = now() WHERE id = ${row.user_id}
          `

          return Option.some({
            id: row.user_id,
            email: row.email,
            displayName: row.display_name
          } satisfies UserProfile)
        },
        Effect.orDie
      )

      const revokeSessionByToken = Effect.fn("AuthRepo.revokeSessionByToken")(
        function*(token: string) {
          const tokenHash = hashToken(token)
          yield* sql`
            UPDATE sessions
            SET revoked_at = now()
            WHERE token_hash = ${tokenHash}
              AND revoked_at IS NULL
          `
        },
        Effect.orDie
      )

      return AuthRepo.of({
        requestMagicLink,
        consumeMagicLink,
        findUserBySessionToken,
        revokeSessionByToken
      })
    })
  )
}
