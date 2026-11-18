const TAKES_VALUE = new Set([
  "-I",
  "-D",
  "-U",
  "-i",
  "-ir",
  "-isystem",
  "-lang",
  "--build",
  "-char",
  "-enum",
  "-sdata",
  "-sdata2",
  "-sdatathreshold",
  "-Cpp_exceptions",
  "-RTTI",
  "-pragma",
  "-inline",
  "-str",
  "-pool",
  "-use_lmw_stmw",
  "-schedule",
  "-fp_contract",
  "-sym",
  "-ipa",
  "-opt",
  "-func_align",
  "--emit-artifacts"
])

export type MwccPlan = {
  readonly ok: true
  readonly cmd: string
  readonly args: ReadonlyArray<string>
  readonly prelude?: {
    readonly path: string
    readonly text: string
  }
}

/**
 * Turn a gcc-style `compiler -c -o file.o file.c` argv into mwcc's
 * `mwcc [flags] -c file.c -o file.o`. mwcc's `-c` takes the source path.
 * `-include` becomes a prelude, because this driver has no `-include`.
 */
export const planMwccCompile = (
  argv: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>
): MwccPlan | { readonly ok: false; readonly reason: string } => {
  const forwarded: string[] = []
  const includes: string[] = []
  let output: string | undefined
  let source: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "-c" || arg === "--version") continue
    if (arg === "-o") {
      const next = argv[i + 1]
      if (next === undefined) return { ok: false, reason: "mwcc-cc: -o needs a path" }
      output = next
      i++
      continue
    }
    if (arg.startsWith("-o") && arg.length > 2) {
      output = arg.slice(2)
      continue
    }
    if (arg === "-include") {
      const header = argv[i + 1]
      if (header === undefined) return { ok: false, reason: "mwcc-cc: -include needs a header" }
      includes.push(header)
      i++
      continue
    }
    if (arg.startsWith("-")) {
      forwarded.push(arg)
      if (TAKES_VALUE.has(arg)) {
        const value = argv[i + 1]
        if (value === undefined) return { ok: false, reason: `mwcc-cc: ${arg} needs a value` }
        forwarded.push(value)
        i++
      }
      continue
    }
    source = arg
  }

  if (output === undefined) return { ok: false, reason: "mwcc-cc: missing -o" }
  if (source === undefined) return { ok: false, reason: "mwcc-cc: missing source file" }

  const extension = source.endsWith(".cpp") || source.endsWith(".cc") || source.endsWith(".cxx")
    ? ".cpp"
    : ".c"
  const preludePath = `${output.replace(/\.o$/, "")}.mwcc${extension}`
  const input = includes.length === 0 ? source : preludePath

  return {
    ok: true,
    cmd: env.MATCHD_MWCC_BIN ?? "mwcc",
    args: [...forwarded, "-c", input, "-o", output],
    ...(includes.length === 0
      ? {}
      : {
          prelude: {
            path: preludePath,
            text: `${includes.map((header) => `#include "${header}"`).join("\n")}\n#include "${source}"\n`
          }
        })
  }
}
