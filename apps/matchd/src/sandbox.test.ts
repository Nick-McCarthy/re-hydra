import assert from "node:assert/strict"
import { test } from "node:test"
import { isJobDir, sandboxArgv, sandboxedSpawn } from "./sandbox.js"

const env = {
  PATH: "/opt/n64/bin:/usr/bin",
  MATCHD_TOKEN: "dev-matchd-token",
  MATCHD_SANDBOX: "bwrap",
  MATCHD_AGBCC_BIN: "/opt/tools/agbcc/bin/agbcc",
  PSPDEV: "/usr/local/pspdev",
  DATABASE_URL: "postgres://secret"
}

test("a job directory is the only writable bind", () => {
  const job = sandboxArgv("gcc", ["-c", "candidate.c"], "/tmp/rehydra-match-abc", env)
  const other = sandboxArgv("gcc", ["--version"], "/app", env)
  assert.equal(isJobDir("/tmp/rehydra-match-abc"), true)
  assert.equal(isJobDir("/tmp/rehydra-link-abc"), true)
  assert.equal(isJobDir("/app"), false)
  assert.ok(job.includes("--bind"))
  assert.equal(other.includes("--bind"), false)
})

test("the sandbox has no network and does not receive the token", () => {
  const spawned = sandboxedSpawn(
    "gcc",
    ["-c", "-o", "candidate.o", "candidate.c"],
    "/tmp/rehydra-match-abc",
    env
  )
  assert.equal(spawned.command, "prlimit")
  assert.ok(spawned.args.includes("--unshare-net"))
  assert.ok(spawned.args.includes("--cpu=30"))
  assert.ok(spawned.args.includes(`--data=${1024 * 1024 * 1024}`))
  assert.equal(spawned.args.includes("dev-matchd-token"), false)
  assert.equal(spawned.args.includes("postgres://secret"), false)
  assert.equal(spawned.env.PATH.includes("MATCHD"), false)
  const marker = spawned.args.indexOf("--")
  const commandAt = spawned.args.indexOf("gcc")
  assert.ok(marker >= 0 && commandAt > marker)
  assert.ok(spawned.args.includes("/opt/tools/agbcc/bin/agbcc"))
  assert.ok(spawned.args.includes("/usr/local/pspdev"))
  assert.ok(spawned.args.includes("/opt/n64/bin:/usr/bin"))
})
