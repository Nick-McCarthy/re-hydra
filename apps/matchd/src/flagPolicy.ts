import { resolveTarget } from "./targets/registry.js"
import type { MatchTarget } from "./targets/types.js"

/**
 * Which compiler flags a project owner may set (audit A-013).
 *
 * Any account can create a project and pick its flags, and the flags reach the
 * compiler inside the sandbox. An allow-list keeps them to code-generation
 * options. A flag must match a known-safe shape for the compiler family, and
 * anything else is refused. These are refused even where the shape would
 * otherwise fit:
 *
 * - anything that runs another program: `-wrapper`, `-fplugin`, `-B`, `-specs`,
 *   `-Wa,`/`-Wl,`/`-Wp,`, `-Xassembler`/`-Xclang`, `-mllvm`, `-load`
 * - anything that reads a named file: `@file`, `-include`, `-imacros`, `-I`,
 *   `-isystem`, `--sysroot`, profile and sanitizer list files
 * - anything that writes a named file or changes the output: `-o`, `-save-temps`,
 *   `-dump*`, `-fdump-*`, `-S`, `-E`, `-x`
 * - paths: any `/`, `\`, or `..`
 *
 * matchd adds `-c`, `-I.`, and `-include types.h` itself, after this check.
 */

export type FlagFamily = MatchTarget["pin"]

export type FlagCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly flag: string; readonly reason: string }

const refuse = (flag: string, reason: string): FlagCheck => ({ ok: false, flag, reason })

/** `-f` options that run code, read files, or write extra files. */
const deniedFOptions = /^-f(no-)?(plugin|profile|auto-profile|sanitize|instrument|dump|save-optimization-record|opt-record|stack-usage|callgraph-info|crash-diagnostics|debug-prefix-map|file-prefix-map|macro-prefix-map|record-command-line|coverage|test-coverage|xray|embed-bitcode|lto)/

const gnuLikeAllowed: ReadonlyArray<RegExp> = [
  /^-c$/,
  /^-O([0-3sgz]|fast)?$/,
  /^-std=[a-z0-9+]+$/,
  /^-ansi$/,
  /^-pedantic(-errors)?$/,
  /^-w$/,
  /^-g([0-3]|gdb|dwarf(-[2-5])?)?$/,
  /^-f(no-)?[A-Za-z0-9][A-Za-z0-9_-]*(=[A-Za-z0-9_.,+-]+)?$/,
  /^-m(no-)?[A-Za-z0-9][A-Za-z0-9_-]*(=[A-Za-z0-9_.,+-]+)?$/,
  // MIPS: small-data size and endianness, as N64 and PlayStation projects use them.
  /^-G[0-9]+$/,
  /^-E[BL]$/,
  /^-nostd(inc|lib)$/,
  /^-W(no-)?[a-z0-9][a-z0-9-]*(=[A-Za-z0-9_.,+-]+)?$/,
  /^-D[A-Za-z_][A-Za-z0-9_]*(=\S*)?$/,
  /^-U[A-Za-z_][A-Za-z0-9_]*$/
]

const clangOnlyAllowed: ReadonlyArray<RegExp> = [/^--target=[a-z0-9_.-]+$/]

/** Named refusals, checked before the shapes so the message says why. */
const gnuLikeDenied: ReadonlyArray<readonly [RegExp, string]> = [
  [/^-wrapper$/, "runs another program around each compiler step"],
  [/^-B/, "changes where the driver looks for programs"],
  [/^-specs/, "loads a specs file that can run programs"],
  [/^-W[alp],/, "passes options straight to the assembler, linker, or preprocessor"],
  [/^-X(assembler|linker|preprocessor|clang)$/, "passes options straight to another tool"],
  [/^-mllvm$/, "passes options straight to LLVM"],
  [/^-load$/, "loads a compiler plugin"],
  [/^-(include|imacros|I|isystem|iquote|idirafter|iprefix|iwithprefix|isysroot)/, "names a file or directory to read"],
  [/^--?sysroot/, "names a directory to read"],
  [/^-o/, "names the output file"],
  [/^-(save-temps|dump)/, "writes extra files"],
  [/^-[SEx]$/, "changes what the compiler produces"],
  [/^-fplugin/, "loads a compiler plugin"]
]

/** mwcc flags that take the next token as their value (see drivers/mwccPlan.ts). */
const mwccValueFlags = new Set([
  "-proc", "-char", "-enum", "-sdata", "-sdata2", "-sdatathreshold", "-Cpp_exceptions", "-RTTI",
  "-pragma", "-inline", "-str", "-pool", "-use_lmw_stmw", "-schedule", "-fp_contract", "-sym",
  "-ipa", "-opt", "-func_align", "-lang", "-fp", "-D", "-U"
])
const mwccDenied: ReadonlyArray<readonly [RegExp, string]> = [
  [/^-(I|i|ir|isystem|include|prefix)\b/, "names a file or directory to read"],
  [/^--(emit-artifacts|build)/, "writes extra files"],
  [/^-o$/, "names the output file"],
  [/^-[EPS]$/, "changes what the compiler produces"]
]

const commonCheck = (flag: string): FlagCheck | undefined => {
  if (flag.length === 0) return refuse(flag, "empty flag")
  if (flag.length > 200) return refuse(flag.slice(0, 40), "flag is longer than 200 characters")
  if (/[\u0000-\u001f\u007f]/.test(flag)) return refuse(flag, "contains a control character")
  if (flag.startsWith("@")) return refuse(flag, "reads more options from a file")
  if (flag.includes("/") || flag.includes("\\") || flag.includes("..")) return refuse(flag, "contains a path")
  return undefined
}

const checkGnuLike = (flags: ReadonlyArray<string>, extra: ReadonlyArray<RegExp>): FlagCheck => {
  for (const flag of flags) {
    const common = commonCheck(flag)
    if (common !== undefined) return common
    for (const [pattern, reason] of gnuLikeDenied) {
      if (pattern.test(flag)) return refuse(flag, reason)
    }
    if (deniedFOptions.test(flag)) return refuse(flag, "runs code, reads a file, or writes extra files")
    if (!flag.startsWith("-")) return refuse(flag, "a file name or value on its own is not allowed")
    if (![...gnuLikeAllowed, ...extra].some((pattern) => pattern.test(flag))) {
      return refuse(flag, "not on the allowed list for this compiler")
    }
  }
  return { ok: true }
}

const checkMwcc = (flags: ReadonlyArray<string>): FlagCheck => {
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i] ?? ""
    const common = commonCheck(flag)
    if (common !== undefined) return common
    for (const [pattern, reason] of mwccDenied) {
      if (pattern.test(flag)) return refuse(flag, reason)
    }
    if (!/^-{1,2}[A-Za-z][A-Za-z0-9_]*(=[A-Za-z0-9_.,+-]+)?$/.test(flag) && !/^-O[0-4](,[ps])?$/.test(flag)) {
      return refuse(flag, "not on the allowed list for this compiler")
    }
    if (mwccValueFlags.has(flag)) {
      const value = flags[i + 1]
      if (value === undefined) return refuse(flag, "needs a value")
      const valueCommon = commonCheck(value)
      if (valueCommon !== undefined) return valueCommon
      if (!/^[A-Za-z0-9_.,=+ ()-]+$/.test(value)) return refuse(value, "value has characters this flag does not take")
      i++
    }
  }
  return { ok: true }
}

export const checkFlags = (family: FlagFamily, flags: ReadonlyArray<string>): FlagCheck => {
  if (flags.length > 64) return refuse(String(flags.length), "more than 64 flags")
  switch (family) {
    case "gcc-cc1":
    case "agbcc":
      return checkGnuLike(flags, [])
    case "clang":
      return checkGnuLike(flags, clangOnlyAllowed)
    case "mwcc":
      return checkMwcc(flags)
  }
}

/** For callers that only know the toolchain image (the API). */
export const checkFlagsForImage = (image: string, flags: ReadonlyArray<string>): FlagCheck => {
  const target = resolveTarget(image)
  if (target === undefined) return refuse(image, "no matchd target is registered for this image")
  return checkFlags(target.pin, flags)
}

export const describeRefusal = (check: Extract<FlagCheck, { ok: false }>): string =>
  `compiler flag not allowed: '${check.flag}' (${check.reason})`
