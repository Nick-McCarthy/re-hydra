import { spawn } from "node:child_process"
import { Config, Effect } from "effect"
import { sandboxedSpawn } from "./sandbox.js"

export type RunResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

const stopChild = (child: ReturnType<typeof spawn>, sandboxed: boolean): void => {
  if (sandboxed && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL")
      return
    } catch {
      // The process group is already gone.
    }
  }
  child.kill("SIGKILL")
}

export const runProcess = (
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeoutMs: number
): Effect.Effect<RunResult, Error> =>
  Effect.gen(function*() {
    const mode = yield* Config.String("MATCHD_SANDBOX").pipe(Config.withDefault("off"))
    if (mode !== "off" && mode !== "bwrap") {
      return yield* Effect.fail(new Error("MATCHD_SANDBOX must be off or bwrap"))
    }
    const sandboxed = mode === "bwrap"
    const spawned = sandboxed ? sandboxedSpawn(cmd, args, cwd, process.env) : undefined
    return yield* Effect.tryPromise({
      try: () =>
        new Promise<RunResult>((resolve, reject) => {
          const child = spawn(
            spawned?.command ?? cmd,
            spawned ? [...spawned.args] : [...args],
            {
              cwd,
              env: spawned?.env ?? process.env,
              windowsHide: true,
              detached: sandboxed
            }
          )
          let stdout = ""
          let stderr = ""
          const timer = setTimeout(() => {
            stopChild(child, sandboxed)
            reject(new Error(`timeout after ${timeoutMs}ms: ${cmd}`))
          }, timeoutMs)
          child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8")
          })
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8")
          })
          child.on("error", (err) => {
            clearTimeout(timer)
            reject(err)
          })
          child.on("close", (code) => {
            clearTimeout(timer)
            resolve({ code, stdout, stderr })
          })
        }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause))
    })
  })

export const objdumpMachine = (arch: string): string => {
  const a = arch.toLowerCase()
  if (a === "x86_64" || a === "amd64" || a === "x86-64") {
    return "i386:x86-64"
  }
  if (a === "x86" || a === "i386") {
    return "i386"
  }
  return "i386:x86-64"
}

export const linkerEmulation = (arch: string): string | undefined => {
  const a = arch.toLowerCase()
  if (a === "x86" || a === "i386") return "elf_i386"
  return undefined
}

export const truncate = (text: string, max = 8_000): string =>
  text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`
