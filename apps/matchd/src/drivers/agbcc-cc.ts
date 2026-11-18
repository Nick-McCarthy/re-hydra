import { spawnSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { planAgbccCompile } from "./agbccPlan.js"

const argv = process.argv.slice(2)
if (argv.includes("--version")) {
  process.stdout.write("agbcc-cc (re-hydra gba driver)\n")
  process.exit(0)
}

const plan = planAgbccCompile(argv, process.env)
if (!plan.ok) {
  process.stderr.write(`${plan.reason}\n`)
  process.exit(1)
}

const run = (cmd: string, args: ReadonlyArray<string>): void => {
  const result = spawnSync(cmd, args, { encoding: "utf8" })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) {
    process.stderr.write(`${cmd}: ${result.error.message}\n`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(plan.cpp.cmd, plan.cpp.args)
run(plan.cc1.cmd, plan.cc1.args)
appendFileSync(plan.asmPath, "\n.text\n\t.align\t2, 0\n")
run(plan.as.cmd, plan.as.args)
