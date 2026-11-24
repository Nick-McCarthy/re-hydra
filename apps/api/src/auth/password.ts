import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { Effect, Schema } from "effect"

const keyLen = 32

/**
 * Audit A-040. scrypt N = 2^17, r = 8, p = 1 (OWASP's current minimum; this
 * was 2^14). It needs 128 * N * r = 128 MiB, above Node's 32 MiB default
 * maxmem, so maxmem is raised for the call. Stored hashes keep their own
 * parameters, so older ones still verify, and sign-in rehashes them.
 */
export const currentParams = { N: 2 ** 17, r: 8, p: 1 } as const
const maxmem = 256 * 1024 * 1024
/** Refuse absurd stored parameters, so a bad row cannot cost gigabytes. */
const maxStoredN = 2 ** 20

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
        scryptCallback(password, salt, keyLen, { ...params, maxmem }, (error, derived) => {
          if (error) reject(error)
          else resolve(derived)
        })
      }),
    catch: (cause) => new PasswordHashFailed({ cause })
  })

/** scrypt string stored on `users.password_hash`. */
export const hashPassword = Effect.fn("hashPassword")(function*(password: string) {
  const params = currentParams
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
  if (N > maxStoredN || r > 32 || p > 4) return false
  const salt = Buffer.from(parts[4] ?? "", "base64url")
  const expected = Buffer.from(parts[5] ?? "", "base64url")
  if (salt.length === 0 || expected.length === 0) return false
  const derived = yield* derive(password, salt, { N, r, p })
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
})

/** True when a stored hash uses weaker parameters than currentParams. */
export const needsRehash = (stored: string): boolean => {
  const parts = stored.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return true
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  return N < currentParams.N || r < currentParams.r || p < currentParams.p
}
