// Checks for audit A-037 (security headers), A-039 (pinned image sources),
// and A-040 (password hashing cost).
//
// Needs an API with RATE_LIMITS=off on a throwaway seeded database.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-hardening.mjs
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const pg = require("pg")

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
if (!DATABASE_URL || !/audit|test/.test(DATABASE_URL)) {
  console.error("Set AUDIT_DATABASE_URL to a throwaway database whose name contains 'audit' or 'test'.")
  process.exit(2)
}
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

// --- A-037: API headers.
{
  const res = await fetch(`${API}/health`)
  const h = (n) => res.headers.get(n)
  check("A-037: API responses carry nosniff, no framing, no referrer, and a deny-all CSP",
    h("x-content-type-options") === "nosniff" && h("x-frame-options") === "DENY" &&
      h("referrer-policy") === "no-referrer" && /default-src 'none'/.test(h("content-security-policy") ?? ""),
    `csp: ${h("content-security-policy")}`)
  const docs = await fetch(API.replace(/\/v1$/, "/docs"))
  check("A-037: /docs keeps its scripts (no deny-all CSP) but still gets nosniff",
    docs.status === 200 && docs.headers.get("content-security-policy") === null && docs.headers.get("x-content-type-options") === "nosniff")
}

// --- A-037: the web build's CSP meta tag, if a build exists.
{
  const dist = path.join(root, "apps/web/dist/index.html")
  let html
  try { html = readFileSync(dist, "utf8") } catch { html = undefined }
  if (html === undefined) {
    console.log("SKIP  A-037: no apps/web/dist build to check (run npm run web:build)")
  } else {
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? ""
    check("A-037: the web build has a CSP with a hash for its one inline script and no unsafe-inline",
      /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/.test(meta) && !meta.includes("unsafe-inline"), meta.slice(0, 80))
  }
}

// --- A-040: the dev account's old-cost hash is upgraded on sign-in.
{
  const db = new pg.Client({ connectionString: DATABASE_URL })
  await db.connect()
  const before = (await db.query(`SELECT password_hash FROM users WHERE email = 'dev@re-hydra.local'`)).rows[0].password_hash
  const res = await fetch(`${API}/auth/sign-in`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dev@re-hydra.local", password: "rehydra-dev" })
  })
  const after = (await db.query(`SELECT password_hash FROM users WHERE email = 'dev@re-hydra.local'`)).rows[0].password_hash
  check("A-040: sign-in works and leaves the hash at N = 2^17",
    (res.status === 200 || res.status === 201) && after.startsWith("scrypt$131072$"),
    `before ${before.split("$").slice(0, 2).join("$")}, after ${after.split("$").slice(0, 2).join("$")}`)
  const again = await fetch(`${API}/auth/sign-in`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dev@re-hydra.local", password: "rehydra-dev" })
  })
  check("A-040: the upgraded hash still signs in", again.status === 200 || again.status === 201, `status ${again.status}`)
  await db.end()
}

// --- A-039: every matchd Dockerfile pins its base image by digest.
{
  const dir = path.join(root, "apps/matchd")
  const files = readdirSync(dir).filter((f) => f.startsWith("Dockerfile"))
  const unpinned = files.filter((f) => /^FROM (?!\S+@sha256:)/m.test(readFileSync(path.join(dir, f), "utf8")))
  check(`A-039: all ${files.length} matchd Dockerfiles pin FROM by digest`, unpinned.length === 0, unpinned.join(", "))
  // Ignore comment lines: the Dockerfiles explain what they replaced.
  const code = (f) => readFileSync(path.join(dir, f), "utf8").split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join("\n")
  const n64 = code("Dockerfile.n64")
  const mwcc = code("Dockerfile.mwcc")
  check("A-039: the N64 GCC tarball and rustup-init are checked by sha256, and Rust is a fixed version",
    /sha256sum -c/.test(n64) && /rustup-init" \| sha256sum -c|rustup-init\s*" \| sha256sum -c/.test(mwcc) &&
      !/sh\.rustup\.rs/.test(mwcc) && /--default-toolchain 1\.\d+\.\d+/.test(mwcc))
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
