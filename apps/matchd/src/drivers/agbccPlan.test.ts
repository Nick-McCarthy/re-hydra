import assert from "node:assert/strict"
import { test } from "node:test"
import { planAgbccCompile } from "./agbccPlan.js"

const env = {
  MATCHD_AGBCC_BIN: "/opt/tools/agbcc/bin/agbcc",
  MATCHD_ARM_AS: "arm-none-eabi-as",
  MATCHD_ARM_CPP: "arm-none-eabi-cpp",
  MATCHD_AGBCC_INCLUDE: "/opt/tools/agbcc/include"
}

test("agbcc-cc splits a gcc-style argv into cpp, cc1, and arm7tdmi as", () => {
  const plan = planAgbccCompile(
    ["-c", "-O2", "-mthumb-interwork", "-I.", "-include", "types.h", "-o", "candidate.o", "candidate.c"],
    env
  )
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.deepEqual(plan.cpp, {
    cmd: "arm-none-eabi-cpp",
    args: [
      "-I/opt/tools/agbcc/include",
      "-nostdinc",
      "-undef",
      "-std=gnu89",
      "-I.",
      "-include",
      "types.h",
      "candidate.c",
      "-o",
      "candidate.i"
    ]
  })
  assert.deepEqual(plan.cc1, {
    cmd: "/opt/tools/agbcc/bin/agbcc",
    args: ["-O2", "-mthumb-interwork", "-o", "candidate.s", "candidate.i"]
  })
  assert.deepEqual(plan.as.args, ["-mcpu=arm7tdmi", "-o", "candidate.o", "candidate.s"])
})

test("thumb mode is passed to the assembler", () => {
  const plan = planAgbccCompile(["-c", "-mthumb", "-O2", "-o", "candidate.o", "candidate.c"], env)
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  assert.equal(plan.as.args.includes("-mthumb"), true)
  assert.equal(plan.cc1.args.includes("-mthumb"), true)
})
