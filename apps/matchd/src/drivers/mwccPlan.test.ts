import assert from "node:assert/strict"
import { test } from "node:test"
import { planMwccCompile } from "./mwccPlan.js"

const env = { MATCHD_MWCC_BIN: "/opt/mwcc/bin/mwcc" }

test("mwcc-cc turns a gcc argv into mwcc -c source -o object", () => {
  const plan = planMwccCompile(
    ["-c", "-O2", "-sdata", "0", "-I.", "-include", "types.h", "-o", "candidate.o", "candidate.c"],
    env
  )
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.cmd, "/opt/mwcc/bin/mwcc")
  assert.deepEqual(plan.args, [
    "-O2",
    "-sdata",
    "0",
    "-I.",
    "-c",
    "candidate.mwcc.c",
    "-o",
    "candidate.o"
  ])
  assert.equal(plan.prelude?.path, "candidate.mwcc.c")
  assert.equal(plan.prelude?.text, '#include "types.h"\n#include "candidate.c"\n')
})

test("a source file with no forced header is passed through", () => {
  const plan = planMwccCompile(["-c", "--build", "GC/1.3.2", "-o", "candidate.o", "candidate.c"], env)
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.prelude, undefined)
  assert.deepEqual(plan.args, ["--build", "GC/1.3.2", "-c", "candidate.c", "-o", "candidate.o"])
})
