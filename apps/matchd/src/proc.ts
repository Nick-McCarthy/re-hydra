import { spawn } from "node:child_process"
import { Effect } from "effect"

export type RunResult = {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

export const runProcess = (
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeoutMs: number
): Effect.Effect<RunResult, Error> =>
  Effect.tryPromise({
    try: () =>
      new Promise<RunResult>((resolve, reject) => {
        const child = spawn(cmd, [...args], {
          cwd,
          env: process.env,
          windowsHide: true
        })
        let stdout = ""
        let stderr = ""
        const timer = setTimeout(() => {
          child.kill("SIGKILL")
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
