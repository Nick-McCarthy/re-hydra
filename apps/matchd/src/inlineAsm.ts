import * as path from "node:path"

/**
 * Inline assembly check (audit A-032).
 *
 * A candidate made of `__asm__(".byte …")` lines can reproduce the original
 * bytes with no translation, so matchd rejects inline assembly unless the
 * chunk allows it. The check runs on preprocessed source, so a macro cannot
 * hide the keyword. Only lines the preprocessor attributes to the candidate or
 * `types.h` count: system headers such as glibc's use `__asm__` for symbol
 * redirects, and those are not the contributor's code. A macro from anywhere
 * (a header, or a `-D` flag) that expands inside the candidate still counts,
 * because its expansion lands on a candidate line.
 */

/** `asm` (GNU C, C++, CodeWarrior), `__asm`/`__asm__` (GNU), `_asm`/`__asm` (MSVC). */
const asmKeyword = /\b(?:asm|_asm|__asm|__asm__)\b/

/**
 * Remove comments and string and character literals, keeping line breaks so
 * line numbers stay right. A string that merely contains "asm" is not inline
 * assembly. The keyword is what makes it one.
 */
export const codeOnly = (text: string): string => {
  let out = ""
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (c === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n"
        i++
      }
      i += 2
      out += " "
      continue
    }
    if (c === "\"" || c === "'") {
      const quote = c
      i++
      while (i < text.length && text[i] !== quote && text[i] !== "\n") {
        if (text[i] === "\\") i++
        i++
      }
      i++
      out += " "
      continue
    }
    out += c
    i++
  }
  return out
}

export type AsmHit = { readonly file: string; readonly line: number; readonly text: string }

/** First inline-assembly keyword in plain (not preprocessed) source. */
export const findInlineAsmInSource = (file: string, text: string): AsmHit | undefined => {
  const lines = codeOnly(text).split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    // Directives count too: `#define A __asm__` is how a macro would hide it.
    const line = lines[n] ?? ""
    if (asmKeyword.test(line)) return { file, line: n + 1, text: line.trim().slice(0, 160) }
  }
  return undefined
}

/**
 * First inline-assembly keyword in preprocessor output, counting only lines
 * attributed to one of `ownFiles` by the `# <line> "<file>"` markers.
 */
export const findInlineAsmInPreprocessed = (
  preprocessed: string,
  ownFiles: ReadonlyArray<string>
): AsmHit | undefined => {
  const own = new Set(ownFiles.map((f) => path.basename(f)))
  const lines = preprocessed.split(/\r?\n/)
  let file = ""
  let line = 0
  for (const raw of lines) {
    const marker = /^#\s*(?:line\s+)?(\d+)\s+"([^"]*)"/.exec(raw)
    if (marker?.[1] !== undefined && marker[2] !== undefined) {
      line = Number.parseInt(marker[1], 10)
      file = marker[2]
      continue
    }
    if (/^\s*#/.test(raw)) {
      line++
      continue
    }
    if (own.has(path.basename(file)) && asmKeyword.test(codeOnly(raw))) {
      return { file: path.basename(file), line, text: raw.trim().slice(0, 160) }
    }
    line++
  }
  return undefined
}

/** Predefined macros for the CodeWarrior approximation (mwcc-rs has no -E). */
export const mwccPredefines = [
  "-D__MWERKS__=0x4302",
  "-D__CWCC__=0x4302",
  "-D__PPC__=1",
  "-D__POWERPC__=1",
  "-D__ppc__=1",
  "-D__GEKKO__=1",
  "-D__STDC__=1"
]

export type PreprocessCommand = {
  readonly cmd: string
  readonly args: ReadonlyArray<string>
  /** True when the command is not the target compiler's own preprocessor. */
  readonly approximate: boolean
}

/**
 * How to preprocess for one target, given the compile argv `flags` (already
 * including `-c`, `-I.`, and `-include types.h`).
 */
export const preprocessCommand = (
  compiler: string,
  flags: ReadonlyArray<string>,
  sourceFile: string,
  outFile: string,
  agbccCpp: (argv: ReadonlyArray<string>) => { readonly cmd: string; readonly args: ReadonlyArray<string> } | undefined,
  env: Readonly<Record<string, string | undefined>>
): PreprocessCommand | { readonly error: string } => {
  const driver = path.basename(compiler)
  if (driver === "agbcc-cc") {
    const cpp = agbccCpp([...flags, "-o", outFile.replace(/\.i$/, ".o"), sourceFile])
    if (cpp === undefined) return { error: "agbcc-cc: cannot plan the preprocessor step" }
    return { cmd: cpp.cmd, args: cpp.args, approximate: false }
  }
  if (driver === "mwcc-cc") {
    const forwarded: string[] = []
    for (let i = 0; i < flags.length; i++) {
      const arg = flags[i] ?? ""
      if (arg === "-I" || arg === "-D" || arg === "-U" || arg === "-include") {
        const value = flags[i + 1]
        if (value !== undefined) forwarded.push(arg, value)
        i++
        continue
      }
      if (/^-[IDU]./.test(arg)) forwarded.push(arg)
    }
    return {
      cmd: env.MATCHD_MWCC_CPP ?? "gcc",
      args: ["-E", "-undef", "-nostdinc", ...mwccPredefines, ...forwarded, "-o", outFile, "-x", "c", sourceFile],
      approximate: true
    }
  }
  const args: string[] = []
  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i] ?? ""
    if (arg === "-c") {
      args.push("-E")
      continue
    }
    if (arg === "-o") {
      i++
      continue
    }
    args.push(arg)
  }
  if (!args.includes("-E")) args.unshift("-E")
  return { cmd: compiler, args: [...args, "-o", outFile, sourceFile], approximate: false }
}

/**
 * Audit A-033. A source may only pull in its own files (the candidate and
 * types.h), the preprocessor's built-ins, and real header directories: paths
 * under /usr/ or /opt/ with an /include/ segment and no "..". Anything else
 * (/etc/hostname, /proc/..., matchd's own files) would echo container files
 * back to the contributor in diagnostics.
 */
export const isAllowedIncludePath = (file: string, ownFiles: ReadonlyArray<string>): boolean => {
  if (file === "" || file.startsWith("<")) return true
  const own = new Set(ownFiles.map((f) => path.posix.basename(f)))
  if (!file.startsWith("/")) {
    // Relative names resolve in the job directory.
    return !file.split("/").includes("..") && own.has(path.posix.basename(file))
  }
  if (file.split("/").includes("..")) return false
  if (/^\/tmp\/rehydra-(match|link)-[^/]+\//.test(file)) return own.has(path.posix.basename(file))
  return (file.startsWith("/usr/") || file.startsWith("/opt/")) && file.includes("/include/")
}

/** First file the preprocessor read that a source may not include. */
export const findOutsideInclude = (
  preprocessed: string,
  ownFiles: ReadonlyArray<string>
): string | undefined => {
  for (const raw of preprocessed.split(/\r?\n/)) {
    const marker = /^#\s*(?:line\s+)?\d+\s+"([^"]*)"/.exec(raw)
    const file = marker?.[1]
    if (file !== undefined && !isAllowedIncludePath(file, ownFiles)) return file
  }
  return undefined
}

/** Paths named at the start of compiler diagnostics ("/etc/x:1:2: error ..."). */
export const outsidePathsInDiagnostics = (
  text: string,
  ownFiles: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const found = new Set<string>()
  for (const match of text.matchAll(/(?:^|\s)(\/[^\s:"]+):\d+/gm)) {
    const file = match[1]
    if (file !== undefined && !isAllowedIncludePath(file, ownFiles)) found.add(file)
  }
  return [...found]
}
