// End-to-end checks for audit A-013 (compiler flag allow-list, memory cap).
//
// Starts one temporary container per local matchd image (with the repo's
// seccomp profile), compiles a plain function on each, and posts the hostile
// flags from the phase 4 review. Then checks the API refuses those flags when a
// project is created or updated. Needs Docker, the rebuilt images, and an API
// with RATE_LIMITS=off on a throwaway database.
//
//   AUDIT_API=http://localhost:3100/v1 node apps/api/scripts/verify-flags.mjs
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const TOKEN = "verify-flags-token"
const profile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docker-yml/matchd-seccomp.json")

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", env: { ...process.env, MATCHD_TOKEN: TOKEN } }).trim()

// image tag -> registered toolchain image, plus a plain C function and its arch.
const images = [
  ["re-hydra-matchd", "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev"],
  ["re-hydra-matchd-n64", "ghcr.io/re-hydra/n64-gcc:2.8.1"],
  ["re-hydra-matchd-mwcc", "ghcr.io/re-hydra/mwcc:gc"],
  ["re-hydra-matchd-coff", "ghcr.io/re-hydra/clang:msvc-x64"],
  ["re-hydra-matchd-switch", "ghcr.io/re-hydra/clang:switch"],
  ["re-hydra-matchd-ps1", "ghcr.io/re-hydra/ps1-gcc:mipsel"],
  ["re-hydra-matchd-ps2", "ghcr.io/re-hydra/ps2-gcc:mips64el"],
  ["re-hydra-matchd-psp", "ghcr.io/re-hydra/psp-gcc:allegrex"],
  ["re-hydra-matchd-ps3", "ghcr.io/re-hydra/ps3-gcc:powerpc64"],
  ["re-hydra-matchd-ps4", "ghcr.io/re-hydra/clang:ps4"],
  ["re-hydra-matchd-xbox", "ghcr.io/re-hydra/clang:xbox"],
  ["re-hydra-matchd-wiiu", "ghcr.io/re-hydra/wiiu-gcc:powerpc"],
  ["re-hydra-matchd-ds", "ghcr.io/re-hydra/ds-gcc:arm"],
  ["re-hydra-matchd-3ds", "ghcr.io/re-hydra/3ds-gcc:arm"],
  ["re-hydra-matchd-dc", "ghcr.io/re-hydra/dc-gcc:sh4"],
  ["re-hydra-matchd-saturn", "ghcr.io/re-hydra/saturn-gcc:sh2"],
  ["re-hydra-matchd-genesis", "ghcr.io/re-hydra/genesis-gcc:68000"]
]

const job = (image, flags, source = "int parse_header(int x) { return x * 3 + 1; }\n") => ({
  jobId: `flags-${randomBytes(3).toString("hex")}`, arch: "any", language: "c",
  toolchain: { compiler: "cc", version: "x", flags, image }, flags,
  entrySymbol: "parse_header", originalBytesBase64: Buffer.from([0x90]).toString("base64"),
  sources: [{ path: "candidate.c", text: source }, { path: "types.h", text: "/* empty */\n" }]
})
const post = async (url, body) => {
  const res = await fetch(`${url}/v1/jobs`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(body) })
  return res.json()
}
const firstLine = (s) => String(s ?? "").split("\n")[0].slice(0, 120)

let port = 3400
for (const [tag, image] of images) {
  const name = `verify-flags-${port}`
  try { docker("rm", "-f", name) } catch {}
  docker("run", "-d", "--name", name, "--security-opt", `seccomp=${profile}`, "-e", "MATCHD_TOKEN", "-p", `127.0.0.1:${port}:3001`, tag)
  const url = `http://127.0.0.1:${port}`
  port++
  try {
    let up = false
    for (let i = 0; i < 40 && !up; i++) {
      try { up = (await fetch(`${url}/v1/health`)).ok } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    const flags = image.includes("mwcc") ? ["-O4,p", "-proc", "gekko"] : ["-O2"]
    const plain = await post(url, job(image, flags))
    // A miss is expected (the original is one nop); compilerOk shows the compile ran under the memory cap.
    check(`${tag}: a plain compile works under the memory cap`, plain.compilerOk === true, plain.compilerOk ? "" : firstLine(plain.diagnostics))
    const wrapper = await post(url, job(image, [...flags, "-wrapper", "/bin/sh,-c,id"]))
    const atFile = await post(url, job(image, [...flags, "@/etc/passwd"]))
    check(`${tag}: -wrapper and @file are refused before compiling`,
      /compiler flag not allowed/.test(wrapper.diagnostics) && /compiler flag not allowed/.test(atFile.diagnostics) && !/root:x:0/.test(atFile.diagnostics),
      `${firstLine(wrapper.diagnostics)} | ${firstLine(atFile.diagnostics)}`)
  } finally {
    try { docker("rm", "-f", name) } catch {}
  }
}

// The memory cap itself, as sandbox.ts sets it (prlimit --data): a real 400 MB
// allocation fails under a 256 MB cap and succeeds under the 1 GB default.
{
  const alloc = (cap) => execFileSync("docker", ["run", "--rm", "--security-opt", `seccomp=${profile}`, "--entrypoint", "sh", "re-hydra-matchd", "-c",
    `prlimit --data=${cap} -- node -e "Buffer.alloc(400*1024*1024).fill(1)" >/dev/null 2>&1; echo exit=$?`], { encoding: "utf8" }).trim()
  const low = alloc(268435456)
  const high = alloc(1073741824)
  check("memory cap: 400 MB fails under 256 MB and succeeds under 1 GB", low !== "exit=0" && high === "exit=0", `256 MB: ${low}, 1 GB: ${high}`)
}

// The API refuses the same flags when a recipe is saved.
{
  const call = async (method, p, token, body) => {
    const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const signIn = await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })
  const token = signIn.body.token
  const slug = `flags-${randomBytes(3).toString("hex")}`
  const base = { slug, name: "Flag check", homeRegion: "us-east-1", language: "c", toolchain: { compiler: "gcc", version: "4.8.5", image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" } }
  const bad = await call("POST", "/projects", token, { ...base, toolchain: { ...base.toolchain, flags: ["-O2", "-wrapper", "/bin/sh,-c,id"] } })
  check("API: creating a project with -wrapper is refused with the reason", bad.status === 400 && /-wrapper/.test(JSON.stringify(bad.body)), `status ${bad.status}: ${JSON.stringify(bad.body?.detail ?? bad.body).slice(0, 100)}`)
  const unknown = await call("POST", "/projects", token, { ...base, slug: `${slug}-x`, toolchain: { ...base.toolchain, image: "ghcr.io/evil/image:latest", flags: ["-O2"] } })
  check("API: creating a project with an unregistered image is refused", unknown.status === 400, `status ${unknown.status}`)
  const good = await call("POST", "/projects", token, { ...base, toolchain: { ...base.toolchain, flags: ["-O2", "-fno-common"] } })
  check("API: a project with ordinary flags is created", good.status === 201, `status ${good.status}`)
  // The settings schema already refuses flags that do not start with "-", so
  // use one that passes the schema and only the policy refuses.
  const update = await call("PATCH", `/projects/${slug}/settings`, token, { flags: ["-O2", "-fplugin=evil.so"] })
  check("API: changing flags to a plugin is refused with the reason", update.status === 400 && /fplugin/.test(JSON.stringify(update.body)), `status ${update.status}: ${JSON.stringify(update.body?.detail ?? update.body).slice(0, 100)}`)
  const atFile = await call("PATCH", `/projects/${slug}/settings`, token, { flags: ["-O2", "@/etc/passwd"] })
  check("API: changing flags to @file is refused (by the settings schema)", atFile.status === 400, `status ${atFile.status}`)
}

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
