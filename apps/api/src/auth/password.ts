import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { Effect, Schema } from "effect"

const keyLen = 32

export class PasswordHashFailed extends Schema.TaggedError<
  PasswordHashFailed,
  { readonly brand: unique symbol }
>()(
  "PasswordHashFailed",
  { cause: Schema.Unknown }
) {}

const derive = (
  password: string,
  salt: Buffer,
  params: { readonly N: number; readonly r: number; readonly p: number }
): Effect.Effect<Buffer, PasswordHashFailed> =>
  Effect.tryPromise({
    try: () =>
      new Promise<Buffer>((resolve, reject) => {
        scryptCallback(password, salt, keyLen, params, (error, derived) => {
          if (error) reject(error)
          else resolve(derived)
        })
      }),
    catch: (cause) => new PasswordHashFailed({ cause })
  })

/** scrypt string stored on `users.password_hash`. */
export const hashPassword = Effect.fn("hashPassword")(function*(password: string) {
  const params = { N: 16384, r: 8, p: 1 }
  const salt = randomBytes(16)
  const derived = yield* derive(password, salt, params)
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`
})

/** False when the stored string is missing, malformed, or does not match. */
export const verifyPassword = Effect.fn("verifyPassword")(function*(
  password: string,
  stored: string
) {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  if (N < 2 || r < 1 || p < 1) return false
  const salt = Buffer.from(parts[4] ?? "", "base64url")
  const expected = Buffer.from(parts[5] ?? "", "base64url")
  if (salt.length === 0 || expected.length === 0) return false
  const derived = yield* derive(password, salt, { N, r, p })
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
})
