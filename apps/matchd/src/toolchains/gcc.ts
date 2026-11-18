import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { Effect } from "effect"
import { runProcess, type RunResult } from "../proc.js"
import { toolchainDigest, type ResolvedToolchain } from "../toolchain.js"

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

/**
 * Pin a GNU driver by hashing `cc1`/`cc1plus` and `as`.
 * CodeWarrior, MSVC, and Clang targets need their own pin module.
 */
export const resolveGccToolchain = Effect.fn("resolveGccToolchain")(function*(
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
