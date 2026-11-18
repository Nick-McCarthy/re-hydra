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
 * Pin the `mwcc` binary. It writes a PowerPC ELF object itself, so there is
 * no separate assembler. The recipe flags, including `-sdata`, stay in the digest.
 * `MATCHD_MWCC_BIN` is that binary. The `mwcc-cc` wrapper is not part of the pin.
 */
export const resolveMwccToolchain = Effect.fn("resolveMwccToolchain")(function*(
  language: "c" | "cpp",
  flags: ReadonlyArray<string>
) {
  const bin = yield* Config.String("MATCHD_MWCC_BIN").pipe(Config.withDefault(""))
  if (bin.length === 0) {
    return {
      ok: false as const,
      reason: "MATCHD_MWCC_BIN is not set"
    } satisfies ResolvedToolchain
  }
  const backendPath = findTool(bin)
  if (backendPath === undefined) {
    return {
      ok: false as const,
      reason: `mwcc is not installed (${bin})`
    } satisfies ResolvedToolchain
  }
  const compilerSha256 = hashFile(backendPath)
  if (compilerSha256 === undefined) {
    return {
      ok: false as const,
      reason: "could not read mwcc"
    } satisfies ResolvedToolchain
  }
  const assemblerSha256 = createHash("sha256").update("").digest("hex")
  return {
    ok: true as const,
    compilerSha256,
    assemblerSha256,
    digest: toolchainDigest(compilerSha256, assemblerSha256, flags, language)
  } satisfies ResolvedToolchain
})
