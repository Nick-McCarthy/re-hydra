import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { planMwccCompile } from "./mwccPlan.js"

const argv = process.argv.slice(2)
if (argv.includes("--version")) {
  process.stdout.write("mwcc-cc (re-hydra gamecube driver)\n")
  process.exit(0)
}

const plan = planMwccCompile(argv, process.env)
if (!plan.ok) {
  process.stderr.write(`${plan.reason}\n`)
  process.exit(1)
}
if (plan.prelude !== undefined) {
  writeFileSync(plan.prelude.path, plan.prelude.text, "utf8")
}

const result = spawnSync(plan.cmd, plan.args, { encoding: "utf8" })
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) {
  process.stderr.write(`${plan.cmd}: ${result.error.message}\n`)
  process.exit(1)
}
process.exit(result.status ?? 1)
