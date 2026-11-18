import assert from "node:assert/strict"
import { test } from "node:test"
import { matchdUrls, parseMatchdRoutes } from "./matchdRoutes.js"
import {
  decideScale,
  localMatchdImage,
  parseDockerPort,
  pickUrl,
  scaleContainerName
} from "./matchdScale.js"

const dc = "ghcr.io/re-hydra/dc-gcc:sh4"

test("one image can list several warm copies", () => {
  const parsed = parseMatchdRoutes(
    `${dc}=http://127.0.0.1:3024|http://127.0.0.1:3124/`
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(matchdUrls(dc, "http://127.0.0.1:3001", parsed.routes), [
    "http://127.0.0.1:3024",
    "http://127.0.0.1:3124"
  ])
})

test("a repeated copy of the same url is refused", () => {
  const parsed = parseMatchdRoutes(`${dc}=http://127.0.0.1:3024|http://127.0.0.1:3024`)
  assert.equal(parsed.ok, false)
})

test("a busy url is left for a quieter copy", () => {
  const inflight = new Map<string, number>([
    ["http://127.0.0.1:3024", 3],
    ["http://127.0.0.1:3124", 1]
  ])
  assert.equal(
    pickUrl(["http://127.0.0.1:3024", "http://127.0.0.1:3124"], inflight),
    "http://127.0.0.1:3124"
  )
})

test("interactive wait past 30 seconds asks for another copy", () => {
  assert.equal(
    decideScale({
      waitMs: 30_000,
      queued: 2,
      claimed: 1,
      urls: 1,
      warm: 1,
      maxUrls: 4,
      pending: false,
      idleMs: 0
    }),
    "out"
  )
  assert.equal(
    decideScale({
      waitMs: 29_000,
      queued: 2,
      claimed: 0,
      urls: 1,
      warm: 1,
      maxUrls: 4,
      pending: false,
      idleMs: 0
    }),
    "hold"
  )
  assert.equal(
    decideScale({
      waitMs: 60_000,
      queued: 3,
      claimed: 0,
      urls: 4,
      warm: 1,
      maxUrls: 4,
      pending: false,
      idleMs: 0
    }),
    "hold"
  )
})

test("an empty image drops one extra copy and keeps the warm process", () => {
  assert.equal(
    decideScale({
      waitMs: 0,
      queued: 0,
      claimed: 0,
      urls: 2,
      warm: 1,
      maxUrls: 4,
      pending: false,
      idleMs: 60_000
    }),
    "in"
  )
  assert.equal(
    decideScale({
      waitMs: 0,
      queued: 0,
      claimed: 0,
      urls: 1,
      warm: 1,
      maxUrls: 4,
      pending: false,
      idleMs: 120_000
    }),
    "hold"
  )
  assert.equal(
    decideScale({
      waitMs: 0,
      queued: 0,
      claimed: 1,
      urls: 2,
      warm: 1,
      maxUrls: 4,
      pending: false,
      idleMs: 120_000
    }),
    "hold"
  )
})

test("a scale container name comes from the local tag", () => {
  assert.equal(scaleContainerName(localMatchdImage[dc] ?? "", 2), "rehydra-scale-dc-2")
  assert.equal(scaleContainerName("re-hydra-matchd", 2), "rehydra-scale-host-2")
  assert.equal(parseDockerPort("127.0.0.1:32768\n"), 32768)
  assert.equal(parseDockerPort("no port"), undefined)
})
