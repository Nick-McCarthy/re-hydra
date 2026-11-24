/**
 * Fixed-window rate limiting (audit A-035).
 *
 * In memory, per API process. With several API processes the effective limit
 * is that many times higher, and a second site needs a shared store (Redis or
 * Postgres) instead. That is noted in the audit change log.
 */

export type Take =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly retryAfterSeconds: number }

type Window = { count: number; resetAt: number }

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>()
  private takesSincePrune = 0

  /** Count one hit for `key`. `limit` hits are allowed per `windowMs`. */
  take(key: string, limit: number, windowMs: number, now: number = Date.now()): Take {
    this.maybePrune(now)
    const current = this.windows.get(key)
    if (current === undefined || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs })
      return { ok: true, remaining: limit - 1 }
    }
    if (current.count >= limit) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) }
    }
    current.count++
    return { ok: true, remaining: limit - current.count }
  }

  get size(): number {
    return this.windows.size
  }

  private maybePrune(now: number): void {
    if (++this.takesSincePrune < 1000) return
    this.takesSincePrune = 0
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key)
    }
  }
}

export type RouteRule = {
  readonly name: string
  readonly method: string
  readonly path: RegExp
  readonly limit: number
  readonly windowMs: number
}

const minute = 60_000
const hour = 60 * minute

/**
 * Per client address. Sign-in also has a per-email limit in AuthRepo, so
 * spreading guesses over many addresses cannot brute-force one account.
 */
export const routeRules: ReadonlyArray<RouteRule> = [
  { name: "sign-in", method: "POST", path: /^\/v1\/auth\/sign-in$/, limit: 10, windowMs: minute },
  { name: "sign-up", method: "POST", path: /^\/v1\/auth\/sign-up$/, limit: 5, windowMs: hour },
  { name: "password", method: "POST", path: /^\/v1\/auth\/password$/, limit: 5, windowMs: 15 * minute },
  { name: "tokens", method: "POST", path: /^\/v1\/auth\/tokens$/, limit: 10, windowMs: hour },
  { name: "create-project", method: "POST", path: /^\/v1\/projects$/, limit: 10, windowMs: hour },
  { name: "import", method: "POST", path: /^\/v1\/projects\/[^/]+\/imports$/, limit: 20, windowMs: hour },
  { name: "checkout", method: "POST", path: /^\/v1\/projects\/[^/]+\/chunks\/[^/]+\/checkout$/, limit: 30, windowMs: minute },
  { name: "submit", method: "POST", path: /^\/v1\/projects\/[^/]+\/chunks\/[^/]+\/submit$/, limit: 30, windowMs: minute }
]

/** Every request from one address, as a backstop against floods. */
export const globalRule: RouteRule = { name: "all", method: "*", path: /.*/, limit: 600, windowMs: minute }

/** Per email address for sign-in, checked once the body is parsed. */
export const signInEmailRule = { limit: 10, windowMs: 15 * minute }

export const matchingRules = (method: string, path: string): ReadonlyArray<RouteRule> =>
  routeRules.filter((rule) => rule.method === method && rule.path.test(path))

/** The import route takes a whole Ghidra export; everything else is small. */
export const isImportPath = (path: string): boolean => /^\/v1\/projects\/[^/]+\/imports$/.test(path)
