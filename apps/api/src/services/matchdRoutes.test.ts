import assert from "node:assert/strict"
import { test } from "node:test"
import { matchdBaseUrl, parseMatchdRoutes } from "./matchdRoutes.js"

const dc = "ghcr.io/re-hydra/dc-gcc:sh4"
const ps2 = "ghcr.io/re-hydra/ps2-gcc:mips64el"

test("an empty route list keeps every image on the default URL", () => {
  const parsed = parseMatchdRoutes("  ")
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(matchdBaseUrl(dc, "http://127.0.0.1:3001/", parsed.routes), "http://127.0.0.1:3001")
})

test("a listed image uses its own matchd URL", () => {
  const parsed = parseMatchdRoutes(
    `${dc}=http://127.0.0.1:3024/, ${ps2}=http://127.0.0.1:3016`
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(matchdBaseUrl(dc, "http://127.0.0.1:3001", parsed.routes), "http://127.0.0.1:3024")
  assert.equal(matchdBaseUrl(ps2, "http://127.0.0.1:3001", parsed.routes), "http://127.0.0.1:3016")
  assert.equal(
    matchdBaseUrl("ghcr.io/re-hydra/gcc:host", "http://127.0.0.1:3001", parsed.routes),
    "http://127.0.0.1:3001"
  )
})

test("a route without a url is refused", () => {
  const parsed = parseMatchdRoutes(`${dc}`)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.match(parsed.reason, /image=url/)
})

test("a duplicate image is refused", () => {
  const parsed = parseMatchdRoutes(
    `${dc}=http://127.0.0.1:3024,${dc}=http://127.0.0.1:3999`
  )
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.match(parsed.reason, /duplicate/)
})
