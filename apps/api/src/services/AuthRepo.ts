import { createHash, randomBytes, randomUUID } from "node:crypto"
import { Context, Effect, Layer, Option } from "effect"
import { NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import { hashPassword, needsRehash, verifyPassword } from "../auth/password.js"
import type {
  AccessTokenCreatedBody,
  AccessTokenSummary,
  ChangePasswordPayload,
  SessionResponse,
  SignInPayload,
  SignUpPayload,
  TokenScope,
  UserProfile
} from "../domain/Auth.js"
import {
  AccountRejected,
  EmailTaken,
  InvalidCredentials,
  AccountSuspended,
  SignInLimited,
  PasswordRejected,
  TokenRejected
} from "../domain/Auth.js"
import type { Uuid } from "../domain/Uuid.js"
import { signInEmailRule } from "../http/rateLimit.js"
import { RateLimits } from "./RateLimits.js"
import { POLICY_VERSION } from "../domain/Moderation.js"

const hashToken = (token: string): Buffer =>
  createHash("sha256").update(token, "utf8").digest()

const newToken = (): string => randomBytes(32).toString("base64url")

const normalizeEmail = (email: string): string => email.trim().toLowerCase()

const wrongCredentials = () =>
  new InvalidCredentials({ detail: "Email or password is wrong." })

type UserRow = {
  readonly id: string
  readonly email: string
  readonly display_name: string
  readonly password_hash: string | null
  readonly is_admin: boolean
  readonly suspended_at: Date | string | null
}

type SessionRow = {
  readonly id: string
  readonly user_id: string
  readonly email: string
  readonly display_name: string
  readonly is_admin: boolean
}

const toProfile = (row: {
  readonly id: string
  readonly email: string
  readonly display_name: string
  readonly is_admin: boolean
}): UserProfile => ({
  id: row.id,
  email: row.email,
  displayName: row.display_name,
  isAdmin: row.is_admin
})

export class AuthRepo extends Context.Service<
  AuthRepo,
  {
    readonly signUp: (
      payload: SignUpPayload
    ) => Effect.Effect<SessionResponse, EmailTaken | AccountRejected>
    readonly signIn: (
      payload: SignInPayload
    ) => Effect.Effect<SessionResponse, InvalidCredentials | SignInLimited | AccountSuspended>
    readonly changePassword: (
      userId: Uuid,
      payload: ChangePasswordPayload
    ) => Effect.Effect<SessionResponse, PasswordRejected>
    readonly findUserBySessionToken: (
      token: string
    ) => Effect.Effect<Option.Option<UserProfile>>
    readonly findUserByAccessToken: (
      token: string
    ) => Effect.Effect<Option.Option<{ readonly user: UserProfile; readonly scope: TokenScope }>>
    readonly createAccessToken: (
      userId: Uuid,
      label: string,
      scope: TokenScope
    ) => Effect.Effect<AccessTokenCreatedBody, TokenRejected>
    readonly listAccessTokens: (
      userId: Uuid
    ) => Effect.Effect<ReadonlyArray<AccessTokenSummary>>
    readonly revokeAccessToken: (
      userId: Uuid,
      tokenId: Uuid
    ) => Effect.Effect<void, NotFound>
    readonly revokeSessionByToken: (token: string) => Effect.Effect<void>
  }
>()("rehydra/services/AuthRepo") {
  static readonly layer = Layer.effect(
    AuthRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const limits = yield* RateLimits
      const sessionTtlDays = 30
      const dummyHash = yield* hashPassword("re-hydra-credential-placeholder").pipe(Effect.orDie)

      const issueSession = Effect.fn("AuthRepo.issueSession")(function*(userId: string) {
        const sessionToken = newToken()
        const sessionHash = hashToken(sessionToken)
        const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60_000)

        yield* sql`
          UPDATE users SET last_seen_at = now() WHERE id = ${userId}
        `.pipe(Effect.orDie)
        yield* sql`
          INSERT INTO sessions (user_id, token_hash, expires_at)
          VALUES (${userId}, ${sessionHash}, ${expiresAt})
        `.pipe(Effect.orDie)

        const users = yield* sql<UserRow>`
          SELECT id, email, display_name, password_hash, is_admin, suspended_at
          FROM users
          WHERE id = ${userId}
          LIMIT 1
        `.pipe(Effect.orDie)
        const user = users[0]
        if (user === undefined) {
          return yield* Effect.die("session user missing")
        }

        return {
          token: sessionToken,
          expiresAt: expiresAt.toISOString(),
          user: toProfile(user)
        } satisfies SessionResponse
      })

      const passwordMatches = Effect.fn("AuthRepo.passwordMatches")(function*(
        password: string,
        stored: string | null
      ) {
        return yield* verifyPassword(password, stored ?? dummyHash)
      })

      const signUp = Effect.fn("AuthRepo.signUp")(function*(payload: SignUpPayload) {
        const email = normalizeEmail(payload.email)
        const displayName = payload.displayName.trim()
        if (displayName.length === 0) {
          return yield* new AccountRejected({
            detail: "Enter a display name."
          })
        }

        if (payload.acceptPolicy !== true) {
          return yield* new AccountRejected({
            detail: "Agree to the content policy to create an account."
          })
        }

        const existing = yield* sql<{ readonly id: string }>`
          SELECT id FROM users WHERE email = ${email} LIMIT 1
        `.pipe(Effect.orDie)
        if (existing[0] !== undefined) {
          return yield* new EmailTaken({
            detail: "An account with that email already exists."
          })
        }

        const passwordHash = yield* hashPassword(payload.password).pipe(Effect.orDie)
        const userId = randomUUID()
        yield* sql`
          INSERT INTO users (id, email, display_name, password_hash, policy_version, policy_accepted_at)
          VALUES (${userId}, ${email}, ${displayName}, ${passwordHash}, ${POLICY_VERSION}, now())
        `.pipe(
          Effect.catchTag("SqlError", (error) => {
            if (error.message.includes("users_email") || error.message.includes("duplicate key")) {
              return Effect.fail(
                new EmailTaken({
                  detail: "An account with that email already exists."
                })
              )
            }
            return Effect.die(error)
          })
        )

        return yield* issueSession(userId).pipe(Effect.orDie)
      })

      const signIn = Effect.fn("AuthRepo.signIn")(function*(payload: SignInPayload) {
        const email = normalizeEmail(payload.email)
        // Audit A-035: per account, so guesses spread over many addresses
        // still stop. Counted before the password check, for every attempt.
        const taken = limits.take(`sign-in-email:${email}`, signInEmailRule.limit, signInEmailRule.windowMs)
        if (!taken.ok) {
          return yield* new SignInLimited({
            detail: `Too many sign-in attempts for this account. Try again in ${taken.retryAfterSeconds} seconds.`
          })
        }
        const rows = yield* sql<UserRow>`
          SELECT id, email, display_name, password_hash, is_admin, suspended_at
          FROM users
          WHERE email = ${email}
          LIMIT 1
        `.pipe(Effect.orDie)
        const row = rows[0]
        const matches = yield* passwordMatches(payload.password, row?.password_hash ?? null).pipe(
          Effect.orDie
        )
        if (row === undefined || row.password_hash === null || !matches) {
          return yield* wrongCredentials()
        }
        if (row.suspended_at !== null) {
          return yield* new AccountSuspended({
            detail: "This account is suspended. To appeal, use the contact address in the content policy."
          })
        }
        // Audit A-040: move older, cheaper hashes up to the current cost. A
        // failure here never blocks the sign-in.
        if (needsRehash(row.password_hash)) {
          yield* hashPassword(payload.password).pipe(
            Effect.flatMap((hash) => sql`UPDATE users SET password_hash = ${hash} WHERE id = ${row.id}`),
            Effect.ignore
          )
        }
        return yield* issueSession(row.id).pipe(Effect.orDie)
      })

      const changePassword = Effect.fn("AuthRepo.changePassword")(function*(
        userId: Uuid,
        payload: ChangePasswordPayload
      ) {
        const rows = yield* sql<UserRow>`
          SELECT id, email, display_name, password_hash, is_admin, suspended_at
          FROM users
          WHERE id = ${userId}
          LIMIT 1
        `.pipe(Effect.orDie)
        const row = rows[0]
        const matches = yield* passwordMatches(
          payload.currentPassword,
          row?.password_hash ?? null
        ).pipe(Effect.orDie)
        if (row === undefined || row.password_hash === null || !matches) {
          return yield* new PasswordRejected({
            detail: "The current password is wrong."
          })
        }

        const passwordHash = yield* hashPassword(payload.newPassword).pipe(Effect.orDie)
        return yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`
            UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}
          `
          yield* sql`
            UPDATE sessions
            SET revoked_at = now()
            WHERE user_id = ${userId}
              AND revoked_at IS NULL
          `
          return yield* issueSession(userId)
        })).pipe(Effect.orDie)
      })

      const findUserBySessionToken = Effect.fn("AuthRepo.findUserBySessionToken")(
        function*(token: string) {
          const tokenHash = hashToken(token)
          const rows = yield* sql<SessionRow>`
            SELECT
              s.id,
              s.user_id,
              u.email,
              u.display_name,
              u.is_admin
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ${tokenHash}
              AND u.suspended_at IS NULL
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
            displayName: row.display_name,
            isAdmin: row.is_admin
          } satisfies UserProfile)
        },
        Effect.orDie
      )

      const findUserByAccessToken = Effect.fn("AuthRepo.findUserByAccessToken")(
        function*(token: string) {
          const tokenHash = hashToken(token)
          const rows = yield* sql<SessionRow & { readonly scope: TokenScope }>`
            SELECT
              t.id,
              t.scope,
              u.id AS user_id,
              u.email,
              u.display_name,
              u.is_admin
            FROM access_tokens t
            INNER JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = ${tokenHash}
              AND u.suspended_at IS NULL
              AND t.revoked_at IS NULL
            LIMIT 1
          `
          const row = rows[0]
          if (row === undefined) {
            return Option.none()
          }

          yield* sql`
            UPDATE access_tokens SET last_used_at = now() WHERE id = ${row.id}
          `
          yield* sql`
            UPDATE users SET last_seen_at = now() WHERE id = ${row.user_id}
          `

          return Option.some({
            user: {
              id: row.user_id,
              email: row.email,
              displayName: row.display_name,
              isAdmin: row.is_admin
            } satisfies UserProfile,
            scope: row.scope
          })
        },
        Effect.orDie
      )

      const createAccessToken = Effect.fn("AuthRepo.createAccessToken")(
        function*(userId: Uuid, label: string, scope: TokenScope) {
          const trimmed = label.trim()
          if (trimmed.length === 0 || trimmed.length > 80) {
            return yield* new TokenRejected({ detail: "Enter a name for this token." })
          }
          const secret = newToken()
          const rows = yield* sql<{ readonly id: string; readonly created_at: Date | string }>`
            INSERT INTO access_tokens (user_id, label, token_hash, scope)
            VALUES (${userId}, ${trimmed}, ${hashToken(secret)}, ${scope})
            RETURNING id, created_at
          `.pipe(Effect.orDie)
          const row = rows[0]
          if (row === undefined) {
            return yield* Effect.die("access token insert returned no row")
          }
          const createdAt = row.created_at instanceof Date
            ? row.created_at.toISOString()
            : new Date(row.created_at).toISOString()
          return {
            id: row.id,
            label: trimmed,
            scope,
            token: secret,
            createdAt
          } satisfies AccessTokenCreatedBody
        }
      )

      const listAccessTokens = Effect.fn("AuthRepo.listAccessTokens")(
        function*(userId: Uuid) {
          const rows = yield* sql<{
            readonly id: string
            readonly label: string
            readonly scope: TokenScope
            readonly created_at: Date | string
            readonly last_used_at: Date | string | null
          }>`
            SELECT id, label, scope, created_at, last_used_at
            FROM access_tokens
            WHERE user_id = ${userId}
              AND revoked_at IS NULL
            ORDER BY created_at DESC
          `
          const iso = (value: Date | string) =>
            value instanceof Date ? value.toISOString() : new Date(value).toISOString()
          return rows.map((row) => ({
            id: row.id,
            label: row.label,
            scope: row.scope,
            createdAt: iso(row.created_at),
            lastUsedAt: row.last_used_at === null ? null : iso(row.last_used_at)
          } satisfies AccessTokenSummary))
        },
        Effect.orDie
      )

      const revokeAccessToken = Effect.fn("AuthRepo.revokeAccessToken")(
        function*(userId: Uuid, tokenId: Uuid) {
          const rows = yield* sql<{ readonly id: string }>`
            UPDATE access_tokens
            SET revoked_at = now()
            WHERE id = ${tokenId}
              AND user_id = ${userId}
              AND revoked_at IS NULL
            RETURNING id
          `.pipe(Effect.orDie)
          if (rows[0] === undefined) {
            return yield* new NotFound()
          }
        }
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
        signUp,
        signIn,
        changePassword,
        findUserBySessionToken,
        findUserByAccessToken,
        createAccessToken,
        listAccessTokens,
        revokeAccessToken,
        revokeSessionByToken
      })
    })
  )
}
