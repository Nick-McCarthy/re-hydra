import assert from "node:assert/strict"
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { test } from "node:test"
import { Effect } from "effect"
import { type CachedUnit, disabledLinkCache, makeLinkCache, matchdBuildId, unitCacheKey } from "./linkCache.js"

const parts = {
  build: "0123456789abcdef",
  target: "host-gcc",
  toolchainDigest: "sha256:v2:abc",
  language: "c",
  flags: ["-c", "-O2", "-I."],
  headers: "typedef int s32;\n",
  symbol: "caller",
  source: "int caller(int x) { return x; }\n"
}

const unit: CachedUnit = {
  version: 1,
  asmHit: null,
  mangled: "caller",
  section: ".text",
  offset: 0,
  size: 4,
  relocations: [{ offset: 1, type: "R_X86_64_PLT32", symbol: "leaf" }],
  undefinedPairs: [{ mangled: "leaf", demangled: "leaf" }]
}

const withDir = async (run: (dir: string) => Promise<void>) => {
  const dir = await mkdtemp(path.join(tmpdir(), "link-cache-test-"))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test("every input that shapes the object changes the key; the address is not one", () => {
  const base = unitCacheKey(parts)
  assert.match(base, /^[0-9a-f]{64}$/)
  assert.equal(unitCacheKey({ ...parts }), base)
  for (const changed of [
    { build: "fedcba9876543210" },
    { target: "ps2-gcc" },
    { toolchainDigest: "sha256:v2:def" },
    { language: "cpp" },
    { flags: ["-c", "-O3", "-I."] },
    { headers: "typedef short s32;\n" },
    { symbol: "other" },
    { source: "int caller(int x) { return x + 1; }\n" }
  ]) {
    assert.notEqual(unitCacheKey({ ...parts, ...changed }), base, JSON.stringify(changed))
  }
})

test("the build ID is a stable hash of matchd's source", () => {
  const id = matchdBuildId()
  assert.match(id, /^[0-9a-f]{16}$/)
  assert.equal(matchdBuildId(), id)
})

test("a stored unit comes back with its object", () =>
  withDir(async (dir) => {
    const cache = makeLinkCache(path.join(dir, "cache"), 1 << 20)
    const key = unitCacheKey(parts)
    const built = path.join(dir, "unit0.o")
    await writeFile(built, Buffer.from([1, 2, 3, 4]))
    assert.equal(await Effect.runPromise(cache.get(key, path.join(dir, "miss.o"))), undefined)
    await Effect.runPromise(cache.put(key, unit, built))
    const restored = path.join(dir, "unit7.o")
    assert.deepEqual(await Effect.runPromise(cache.get(key, restored)), unit)
    assert.deepEqual([...await readFile(restored)], [1, 2, 3, 4])
  }))

test("the least recently used entries go first when the cache is over its size", () =>
  withDir(async (dir) => {
    const cacheDir = path.join(dir, "cache")
    const cache = makeLinkCache(cacheDir, 3000)
    const built = path.join(dir, "unit.o")
    await writeFile(built, Buffer.alloc(900, 7))
    const keys = ["a", "b", "c", "d"].map((symbol) => unitCacheKey({ ...parts, symbol }))
    for (const [at, key] of keys.slice(0, 3).entries()) {
      await Effect.runPromise(cache.put(key, unit, built))
      // Oldest first: a, then b, then c.
      const when = new Date(Date.now() - (10 - at) * 60_000)
      await utimes(path.join(cacheDir, `${key}.json`), when, when)
      await utimes(path.join(cacheDir, `${key}.o`), when, when)
    }
    await Effect.runPromise(cache.put(keys[3]!, unit, built))
    const left = new Set((await readdir(cacheDir)).map((name) => name.slice(0, 64)))
    assert.equal(left.has(keys[0]!), false, "the oldest entry is dropped")
    assert.equal(left.has(keys[3]!), true, "the newest entry stays")
  }))

test("with no cache size, nothing is kept", async () => {
  assert.equal(makeLinkCache("/nowhere", 0), disabledLinkCache)
  assert.equal(await Effect.runPromise(disabledLinkCache.get(unitCacheKey(parts), "/nowhere/x.o")), undefined)
})
