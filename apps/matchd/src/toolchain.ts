import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { Effect } from "effect"
import { runProcess, type RunResult } from "./proc.js"

/** Digest of the compiler backend, the assembler, and the recipe flags. */
export const toolchainDigest = (
  compilerSha256: string,
  assemblerSha256: string,
  flags: ReadonlyArray<string>,
  language: string
): string => {
  const recipe = createHash("sha256")
    .update(JSON.stringify(flags))
    .update("\n")
    .update(language)
    .digest("hex")
  return `sha256:v2:${compilerSha256}:${assemblerSha256}:${recipe}`
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * A v2 digest names the binaries. Older digests are a version string and do
 * not pin anything. A malformed v2 digest does not match. The recipe section
 * may differ: a flag change is a new digest, not a different compiler.
 */
export const sameCompiler = (
  expected: string | undefined,
  compilerSha256: string,
  assemblerSha256: string
): boolean => {
  if (expected === undefined || !expected.startsWith("sha256:v2:")) return true
  const parts = expected.split(":")
  if (
    parts.length !== 5 ||
    parts[0] !== "sha256" ||
    parts[1] !== "v2" ||
    !HEX64.test(parts[2] ?? "") ||
    !HEX64.test(parts[3] ?? "") ||
    !HEX64.test(parts[4] ?? "")
  ) {
    return false
  }
  return parts[2] === compilerSha256 && parts[3] === assemblerSha256
}

const catchRun = (effect: Effect.Effect<RunResult, Error>): Effect.Effect<RunResult> =>
  effect.pipe(
    Effect.catch((err) =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: String(err)
      } satisfies RunResult)
    )
  )

const lastLine = (stdout: string): string => stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? ""

/**
 * `gcc -print-file-name=cc1` is absolute. `as` is often just a name on PATH,
 * which is how the driver finds it.
 */
const resolveTool = (printed: string): string | undefined => {
  if (printed.length === 0) return undefined
  if (path.isAbsolute(printed)) return printed
  if (!/^[A-Za-z0-9._+-]+$/.test(printed)) return undefined
  const dirs = (process.env.PATH ?? "").split(path.delimiter).filter((dir) => dir.length > 0)
  for (const dir of dirs) {
    const candidate = path.join(dir, printed)
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      continue
    }
  }
  return undefined
}

const hashFile = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex")

export type ResolvedToolchain =
  | {
      readonly ok: true
      readonly compilerSha256: string
      readonly assemblerSha256: string
      readonly digest: string
    }
  | { readonly ok: false; readonly reason: string }

/** Hash `cc1`/`cc1plus` and `as` for the compiler that is about to run. */
export const resolveToolchain = Effect.fn("resolveToolchain")(function*(
  compiler: string,
  language: "c" | "cpp",
  flags: ReadonlyArray<string>,
  cwd: string,
  timeoutMs: number
) {
  const backend = language === "cpp" ? "cc1plus" : "cc1"
  const backendRun = yield* catchRun(
    runProcess(compiler, [`-print-file-name=${backend}`], cwd, timeoutMs)
  )
  const assemblerRun = yield* catchRun(
    runProcess(compiler, ["-print-prog-name=as"], cwd, timeoutMs)
  )
  if (backendRun.code !== 0 || assemblerRun.code !== 0) {
    return {
      ok: false as const,
      reason: `${compiler} could not name ${backend} or as`
    } satisfies ResolvedToolchain
  }
  const backendPath = resolveTool(lastLine(backendRun.stdout))
  const assemblerPath = resolveTool(lastLine(assemblerRun.stdout))
  if (backendPath === undefined || assemblerPath === undefined) {
    return {
      ok: false as const,
      reason: `${backend} or as is not installed next to ${compiler}`
    } satisfies ResolvedToolchain
  }
  const read = (file: string): Uint8Array | undefined => {
    try {
      return readFileSync(file)
    } catch {
      return undefined
    }
  }
  const backendBytes = read(backendPath)
  const assemblerBytes = read(assemblerPath)
  if (backendBytes === undefined || assemblerBytes === undefined) {
    return {
      ok: false as const,
      reason: `could not read ${backend} or as`
    } satisfies ResolvedToolchain
  }
  const compilerSha256 = hashFile(backendBytes)
  const assemblerSha256 = hashFile(assemblerBytes)
  return {
    ok: true as const,
    compilerSha256,
    assemblerSha256,
    digest: toolchainDigest(compilerSha256, assemblerSha256, flags, language)
  } satisfies ResolvedToolchain
})
