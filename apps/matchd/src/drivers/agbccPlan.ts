export type AgbccCommand = {
  readonly cmd: string
  readonly args: ReadonlyArray<string>
}

export type AgbccPlan = {
  readonly ok: true
  readonly cpp: AgbccCommand
  readonly cc1: AgbccCommand
  readonly as: AgbccCommand
  readonly asmPath: string
}

/**
 * Turn a gcc-style `compiler -c -o file.o file.c` argv into pret's three steps:
 * preprocess, `agbcc` (cc1), then `arm-none-eabi-as -mcpu=arm7tdmi`.
 */
export const planAgbccCompile = (
  argv: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>>
): AgbccPlan | { readonly ok: false; readonly reason: string } => {
  const cppArgs: string[] = []
  const cc1Args: string[] = []
  let output: string | undefined
  let source: string | undefined
  let thumb = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ""
    if (arg === "-c" || arg === "--version") continue
    if (arg === "-o") {
      const next = argv[i + 1]
      if (next === undefined) return { ok: false, reason: "agbcc-cc: -o needs a path" }
      output = next
      i++
      continue
    }
    if (arg.startsWith("-o") && arg.length > 2) {
      output = arg.slice(2)
      continue
    }
    if (arg === "-mthumb") {
      thumb = true
      cc1Args.push(arg)
      continue
    }
    if (arg === "-include" || arg === "-I" || arg === "-D" || arg === "-U" || arg === "-imacros") {
      const next = argv[i + 1]
      if (next === undefined) return { ok: false, reason: `agbcc-cc: ${arg} needs a value` }
      cppArgs.push(arg, next)
      i++
      continue
    }
    if (arg.startsWith("-I") || arg.startsWith("-D") || arg.startsWith("-U") || arg.startsWith("-std=")) {
      cppArgs.push(arg)
      continue
    }
    if (arg === "-nostdinc" || arg === "-undef") {
      cppArgs.push(arg)
      continue
    }
    if (arg.startsWith("-")) {
      cc1Args.push(arg)
      continue
    }
    source = arg
  }

  if (output === undefined) return { ok: false, reason: "agbcc-cc: missing -o" }
  if (source === undefined) return { ok: false, reason: "agbcc-cc: missing source file" }

  const include = env.MATCHD_AGBCC_INCLUDE ?? "/opt/tools/agbcc/include"
  const stem = output.replace(/\.o$/, "")
  const preprocessed = `${stem}.i`
  const asmPath = `${stem}.s`
  const defaults = [
    `-I${include}`,
    ...(cppArgs.includes("-nostdinc") ? [] : ["-nostdinc"]),
    ...(cppArgs.includes("-undef") ? [] : ["-undef"]),
    ...(cppArgs.some((arg) => arg.startsWith("-std=")) ? [] : ["-std=gnu89"])
  ]

  return {
    ok: true,
    cpp: {
      cmd: env.MATCHD_ARM_CPP ?? "arm-none-eabi-cpp",
      args: [...defaults, ...cppArgs, source, "-o", preprocessed]
    },
    cc1: {
      cmd: env.MATCHD_AGBCC_BIN ?? "agbcc",
      args: [...cc1Args, "-o", asmPath, preprocessed]
    },
    as: {
      cmd: env.MATCHD_ARM_AS ?? "arm-none-eabi-as",
      args: ["-mcpu=arm7tdmi", ...(thumb ? ["-mthumb"] : []), "-o", output, asmPath]
    },
    asmPath
  }
}
