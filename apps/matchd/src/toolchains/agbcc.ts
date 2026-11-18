import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { Config, Effect } from "effect"
import { toolchainDigest, type ResolvedToolchain } from "../toolchain.js"

const findTool = (name: string): string | undefined => {
  if (name.length === 0) return undefined
  if (path.isAbsolute(name)) return name
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) return undefined
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir.length > 0)
  for (const dir of dirs) {
    const candidate = path.join(dir, name)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

const hashFile = (file: string): string | undefined => {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex")
  } catch {
    return undefined
  }
}

/**
 * Pin pret `agbcc` and `arm-none-eabi-as`.
 * `agbcc` is a cc1 binary, not a gcc driver, so `-print-file-name` does not apply.
 * `MATCHD_AGBCC_BIN` is that cc1. The `agbcc-cc` wrapper is not part of the pin.
 */
export const resolveAgbccToolchain = Effect.fn("resolveAgbccToolchain")(function*(
  language: "c" | "cpp",
  flags: ReadonlyArray<string>
) {
  if (language !== "c") {
    return {
      ok: false as const,
      reason: "agbcc compiles C only"
    } satisfies ResolvedToolchain
  }
  const bin = yield* Config.String("MATCHD_AGBCC_BIN").pipe(Config.withDefault(""))
  const assemblerName = yield* Config.String("MATCHD_ARM_AS").pipe(
    Config.withDefault("arm-none-eabi-as")
  )
  if (bin.length === 0) {
    return {
      ok: false as const,
      reason: "MATCHD_AGBCC_BIN is not set"
    } satisfies ResolvedToolchain
  }
  const backendPath = findTool(bin)
  const assemblerPath = findTool(assemblerName)
  if (backendPath === undefined || assemblerPath === undefined) {
    return {
      ok: false as const,
      reason: `agbcc or arm-none-eabi-as is not installed (${bin}, ${assemblerName})`
    } satisfies ResolvedToolchain
  }
  const compilerSha256 = hashFile(backendPath)
  const assemblerSha256 = hashFile(assemblerPath)
  if (compilerSha256 === undefined || assemblerSha256 === undefined) {
    return {
      ok: false as const,
      reason: "could not read agbcc or arm-none-eabi-as"
    } satisfies ResolvedToolchain
  }
  return {
    ok: true as const,
    compilerSha256,
    assemblerSha256,
    digest: toolchainDigest(compilerSha256, assemblerSha256, flags, language)
  } satisfies ResolvedToolchain
})
