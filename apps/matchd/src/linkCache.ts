import { createHash } from "node:crypto"
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { Effect } from "effect"
import type { AsmHit } from "./inlineAsm.js"
import type { ObjectRelocation } from "./linkSymbols.js"

/**
 * Compiled integration units, kept between builds. A project's next build
 * usually differs by a few new matches, so almost every function is the same
 * compile with the same inputs as last time. Entries are keyed by everything
 * that shapes the object, and the address is not one of them: placement
 * happens at link time.
 */

export type CachedUnit = {
  readonly version: 1
  /** Inline assembly the scan found; the chunk's opt-in is checked per build. */
  readonly asmHit: AsmHit | null
  readonly mangled: string
  readonly section: string
  readonly offset: number
  readonly size: number
  readonly relocations: ReadonlyArray<ObjectRelocation>
  readonly undefinedPairs: ReadonlyArray<{ readonly mangled: string; readonly demangled: string }>
}

export type UnitKeyParts = {
  readonly target: string
  readonly toolchainDigest: string
  readonly language: string
  readonly flags: ReadonlyArray<string>
  readonly headers: string
  readonly symbol: string
  readonly source: string
}

export const unitCacheKey = (parts: UnitKeyParts): string =>
  createHash("sha256")
    .update(JSON.stringify([
      "link-unit-v1",
      parts.target,
      parts.toolchainDigest,
      parts.language,
      parts.flags,
      parts.headers,
      parts.symbol,
      parts.source
    ]))
    .digest("hex")

export type LinkCache = {
  readonly get: (key: string, objectPath: string) => Effect.Effect<CachedUnit | undefined>
  readonly put: (key: string, unit: CachedUnit, objectPath: string) => Effect.Effect<void>
}

const KEY = /^[0-9a-f]{64}$/

/** A cache that never hits, for MATCHD_LINK_CACHE_MB=0. */
export const disabledLinkCache: LinkCache = {
  get: () => Effect.succeed(undefined),
  put: () => Effect.void
}

/**
 * An on-disk cache under `dir`, trimmed to about `maxBytes` by dropping the
 * least recently used entries. Every failure is a miss: a lost entry only
 * costs a compile.
 */
export const makeLinkCache = (dir: string, maxBytes: number): LinkCache => {
  if (maxBytes <= 0) return disabledLinkCache
  let writtenSinceTrim = Number.POSITIVE_INFINITY
  let trimming = false

  const files = (key: string) => ({
    meta: path.join(dir, `${key}.json`),
    object: path.join(dir, `${key}.o`)
  })

  const trim = async (): Promise<void> => {
    if (trimming) return
    trimming = true
    try {
      const names = await readdir(dir)
      const entries: Array<{ key: string; bytes: number; used: number }> = []
      const byKey = new Map<string, { bytes: number; used: number }>()
      for (const name of names) {
        const key = name.replace(/\.(json|o|tmp)$/, "")
        if (!KEY.test(key.slice(0, 64))) continue
        const info = await stat(path.join(dir, name)).catch(() => undefined)
        if (info === undefined) continue
        const prior = byKey.get(key) ?? { bytes: 0, used: 0 }
        byKey.set(key, { bytes: prior.bytes + info.size, used: Math.max(prior.used, info.mtimeMs) })
      }
      for (const [key, value] of byKey) entries.push({ key, ...value })
      let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
      if (total <= maxBytes) return
      entries.sort((a, b) => a.used - b.used)
      const target = maxBytes * 0.8
      for (const entry of entries) {
        if (total <= target) break
        const paths = files(entry.key)
        await rm(paths.meta, { force: true })
        await rm(paths.object, { force: true })
        total -= entry.bytes
      }
    } finally {
      writtenSinceTrim = 0
      trimming = false
    }
  }

  return {
    get: (key, objectPath) =>
      Effect.tryPromise(async () => {
        if (!KEY.test(key)) return undefined
        const paths = files(key)
        const meta = JSON.parse(await readFile(paths.meta, "utf8")) as CachedUnit
        if (meta.version !== 1) return undefined
        await copyFile(paths.object, objectPath)
        const now = new Date()
        await utimes(paths.meta, now, now).catch(() => undefined)
        return meta
      }).pipe(Effect.orElseSucceed(() => undefined)),

    put: (key, unit, objectPath) =>
      Effect.tryPromise(async () => {
        if (!KEY.test(key)) return
        await mkdir(dir, { recursive: true })
        const paths = files(key)
        const unique = `${process.pid}-${Math.random().toString(36).slice(2)}`
        const objectTmp = `${paths.object}.${unique}.tmp`
        const metaTmp = `${paths.meta}.${unique}.tmp`
        await copyFile(objectPath, objectTmp)
        await rename(objectTmp, paths.object)
        // The metadata is written last: an entry exists once it is there.
        const text = JSON.stringify(unit)
        await writeFile(metaTmp, text, "utf8")
        await rename(metaTmp, paths.meta)
        const added = (await stat(paths.object)).size + text.length
        writtenSinceTrim += added
        if (writtenSinceTrim > maxBytes * 0.1) await trim()
      }).pipe(Effect.ignore)
  }
}
