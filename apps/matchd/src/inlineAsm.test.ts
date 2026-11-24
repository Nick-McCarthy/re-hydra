import assert from "node:assert/strict"
import { test } from "node:test"
import { planAgbccCompile } from "./drivers/agbccPlan.js"
import {
  codeOnly,
  findInlineAsmInPreprocessed,
  findInlineAsmInSource,
  preprocessCommand
} from "./inlineAsm.js"

test("strings and comments that mention asm are not inline assembly", () => {
  const source = [
    "/* this is not asm */",
    "// __asm__ in a comment",
    "const char *s = \"asm(nop)\";",
    "char c = 'a';",
    "int f(void) { return 1; }"
  ].join("\n")
  assert.equal(findInlineAsmInSource("candidate.c", source), undefined)
  assert.equal(codeOnly("a \"x\\\"asm\" b").includes("asm"), false)
})

test("each asm keyword spelling is found in plain source", () => {
  for (const keyword of ["asm", "__asm", "__asm__", "_asm"]) {
    const hit = findInlineAsmInSource("candidate.c", `int f(void) {\n  ${keyword}("nop");\n  return 0;\n}\n`)
    assert.equal(hit?.line, 2, keyword)
  }
  assert.equal(findInlineAsmInSource("candidate.c", "int my_asm_table[4];\nint asmx;\n"), undefined)
})

test("a #define that hides asm is found in plain source", () => {
  const hit = findInlineAsmInSource("types.h", "#define EMIT __asm__\n")
  assert.equal(hit?.file, "types.h")
})

test("preprocessed output: only the candidate's and types.h lines count", () => {
  const preprocessed = [
    "# 1 \"candidate.c\"",
    "# 1 \"/usr/include/string.h\" 1 3 4",
    "extern char *strcpy (char *, const char *) __asm__ (\"\" \"strcpy\");",
    "# 2 \"candidate.c\" 2",
    "int f(void) { return 0; }"
  ].join("\n")
  assert.equal(findInlineAsmInPreprocessed(preprocessed, ["candidate.c", "types.h"]), undefined)
})

test("preprocessed output: a macro expansion on a candidate line is caught with its line", () => {
  const preprocessed = [
    "# 1 \"candidate.c\"",
    "# 1 \"./types.h\" 1",
    "typedef int s32;",
    "# 2 \"candidate.c\" 2",
    "",
    "void parse_header(void) { __asm__(\".byte 0xc3\"); }"
  ].join("\n")
  const hit = findInlineAsmInPreprocessed(preprocessed, ["candidate.c", "types.h"])
  assert.equal(hit?.file, "candidate.c")
  assert.equal(hit?.line, 3)
})

test("preprocess command: gcc and clang swap -c for -E and write their own output", () => {
  const command = preprocessCommand("gcc", ["-c", "-O2", "-I.", "-include", "types.h"], "candidate.c", "candidate.asmcheck.i", () => undefined, {})
  assert.ok(!("error" in command))
  if ("error" in command) return
  assert.deepEqual(command.args, ["-E", "-O2", "-I.", "-include", "types.h", "-o", "candidate.asmcheck.i", "candidate.c"])
  assert.equal(command.approximate, false)
})

test("preprocess command: agbcc uses the driver's own cpp step", () => {
  const command = preprocessCommand(
    "/usr/local/bin/agbcc-cc",
    ["-c", "-O2", "-mthumb", "-I.", "-include", "types.h"],
    "candidate.c",
    "candidate.asmcheck.i",
    (argv) => {
      const plan = planAgbccCompile(argv, {})
      return plan.ok ? plan.cpp : undefined
    },
    {}
  )
  assert.ok(!("error" in command))
  if ("error" in command) return
  assert.equal(command.cmd, "arm-none-eabi-cpp")
  assert.equal(command.args.at(-1), "candidate.asmcheck.i")
  assert.ok(command.args.includes("candidate.c"))
  assert.equal(command.approximate, false)
})

test("preprocess command: mwcc is approximated with GNU cpp and marked so", () => {
  const command = preprocessCommand("mwcc-cc", ["-c", "-O4", "-DGAME=1", "-I.", "-include", "types.h"], "candidate.c", "candidate.asmcheck.i", () => undefined, {})
  assert.ok(!("error" in command))
  if ("error" in command) return
  assert.equal(command.cmd, "gcc")
  assert.equal(command.approximate, true)
  assert.ok(command.args.includes("-D__MWERKS__=0x4302"))
  assert.ok(command.args.includes("-DGAME=1"))
  assert.ok(!command.args.includes("-O4"))
})

test("A-033: includes are limited to own files, built-ins, and header directories", async () => {
  const { isAllowedIncludePath, findOutsideInclude, outsidePathsInDiagnostics } = await import("./inlineAsm.js")
  const own = ["candidate.c", "types.h"]
  for (const ok of [
    "candidate.c", "./types.h", "<built-in>", "<command-line>",
    "/usr/include/string.h", "/usr/lib/gcc/x86_64-linux-gnu/12/include/stddef.h",
    "/opt/tools/agbcc/include/stdio.h", "/usr/local/pspdev/psp/include/stdint.h",
    "/tmp/rehydra-match-abc123/types.h"
  ]) assert.equal(isAllowedIncludePath(ok, own), true, ok)
  for (const bad of [
    "/etc/hostname", "/etc/passwd", "/proc/self/environ", "/app/src/main.ts",
    "/usr/include/../../etc/passwd", "../secret.h", "other.h",
    "/tmp/rehydra-match-other/secret.h", "/proc/self/root/usr/include/x.h", "/usr/share/doc/x"
  ]) assert.equal(isAllowedIncludePath(bad, own), false, bad)
  assert.equal(findOutsideInclude('# 1 "candidate.c"\n# 1 "/etc/hostname" 1\nabc\n# 2 "candidate.c" 2\n', own), "/etc/hostname")
  assert.equal(findOutsideInclude('# 1 "candidate.c"\n# 1 "/usr/include/string.h" 1 3 4\n', own), undefined)
  assert.deepEqual(outsidePathsInDiagnostics("/etc/hostname:1:13: error: expected ';'\n    1 | secret\n", own), ["/etc/hostname"])
  assert.deepEqual(outsidePathsInDiagnostics("candidate.c:3:1: error: expected ';'\n", own), [])
})
