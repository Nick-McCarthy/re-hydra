import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { Config, Effect } from "effect"
import type { MatchJobRequest } from "./domain/Job.js"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"
import { runProcess, truncate, type RunResult } from "./proc.js"
import { resolveEntrySymbol, symbolSize } from "./symbols.js"
import { resolveToolchain, sameCompiler } from "./toolchain.js"

export type MatchEngineResult = {
  readonly matched: boolean
  readonly score: number
  readonly originalInsns: number
  readonly equalInsns: number
  readonly compilerOk: boolean
  readonly diagnostics: string
  readonly toolchainDigest: string
  readonly canonicalSha256: string
}

export const runMatchJob = (
  job: MatchJobRequest
): Effect.Effect<MatchEngineResult> =>
  Effect.gen(function*() {
    const language = job.language ?? "c"
    const compilerName = language === "cpp" ? "MATCHD_GXX" : "MATCHD_GCC"
    const compilerDefault = language === "cpp" ? "g++" : "gcc"
    const compiler = yield* Config.String(compilerName).pipe(
      Config.withDefault(compilerDefault)
    )
    const objdump = yield* Config.String("MATCHD_OBJDUMP").pipe(
      Config.withDefault("objdump")
    )
    const nm = yield* Config.String("MATCHD_NM").pipe(Config.withDefault("nm"))
    const timeoutMs = yield* Config.Int("MATCHD_TIMEOUT_MS").pipe(
      Config.withDefault(30_000)
    )
    const candidateFile = language === "cpp" ? "candidate.cpp" : "candidate.c"

    const flags = [...(job.flags ?? job.toolchain.flags)]
    const version = yield* runProcess(compiler, ["--version"], process.cwd(), timeoutMs).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: String(err)
        } satisfies RunResult)
      )
    )
    const emptySha = createHash("sha256").update("").digest("hex")
    const refused = (diagnostics: string, toolchainDigest: string): MatchEngineResult => ({
      matched: false,
      score: 0,
      originalInsns: 0,
      equalInsns: 0,
      compilerOk: false,
      diagnostics: truncate(diagnostics),
      toolchainDigest,
      canonicalSha256: emptySha
    })

    if (version.code !== 0) {
      return refused(
        `${compiler} unavailable: ${version.stderr || version.stdout}`,
        "sha256:v2:unavailable"
      )
    }

    const resolved = yield* resolveToolchain(compiler, language, flags, process.cwd(), timeoutMs)
    if (!resolved.ok) {
      return refused(resolved.reason, "sha256:v2:unavailable")
    }
    if (!sameCompiler(job.expectedToolchainDigest, resolved.compilerSha256, resolved.assemblerSha256)) {
      return refused(
        `compiler mismatch: this machine is ${resolved.digest}, job required ${job.expectedToolchainDigest}`,
        resolved.digest
      )
    }
    const toolchainDigest = resolved.digest

    const work = yield* Effect.tryPromise({
      try: () => mkdtemp(path.join(tmpdir(), "rehydra-match-")),
      catch: (cause) => new Error(String(cause))
    }).pipe(Effect.orDie)

    const cleanup = Effect.tryPromise({
      try: () => rm(work, { recursive: true, force: true }),
      catch: () => undefined
    }).pipe(Effect.ignore)

    return yield* Effect.gen(function*() {
      for (const file of job.sources) {
        const dest = path.join(work, path.basename(file.path))
        yield* Effect.tryPromise({
          try: () => writeFile(dest, file.text, "utf8"),
          catch: (cause) => new Error(String(cause))
        }).pipe(Effect.orDie)
      }

      if (!flags.includes("-c")) flags.unshift("-c")
      if (!flags.some((f) => f === "-I." || f.startsWith("-I"))) {
        flags.push("-I.")
      }
      const hasTypes = job.sources.some(
        (s) => path.basename(s.path) === "types.h"
      )
      if (hasTypes && !flags.includes("-include")) {
        flags.push("-include", "types.h")
      }

      const hasCandidate = job.sources.some(
        (s) => path.basename(s.path) === candidateFile
      )
      if (!hasCandidate) {
        return {
          matched: false,
          score: 0,
          originalInsns: 0,
          equalInsns: 0,
          compilerOk: false,
          diagnostics: `missing ${candidateFile} in sources`,
          toolchainDigest,
          canonicalSha256: createHash("sha256").update("").digest("hex")
        }
      }

      const compile = yield* runProcess(
        compiler,
        [...flags, "-o", "candidate.o", candidateFile],
        work,
        timeoutMs
      ).pipe(
        Effect.catch((err) =>
          Effect.succeed({
            code: 1,
            stdout: "",
            stderr: String(err)
          } satisfies RunResult)
        )
      )

      if (compile.code !== 0) {
        return {
          matched: false,
          score: 0,
          originalInsns: 0,
          equalInsns: 0,
          compilerOk: false,
          diagnostics: truncate(
            `compile failed:\n${compile.stderr || compile.stdout}`
          ),
          toolchainDigest,
          canonicalSha256: createHash("sha256").update("").digest("hex")
        }
      }

      const sizedNm = yield* runProcess(nm, ["-S", "candidate.o"], work, timeoutMs).pipe(
        Effect.catch((err) =>
          Effect.succeed({
            code: 1,
            stdout: "",
            stderr: String(err)
          } satisfies RunResult)
        )
      )
      let entrySymbol = job.entrySymbol
      let size = symbolSize(sizedNm.stdout, entrySymbol)
      if (size === undefined && language === "cpp") {
        const demangledNm = yield* runProcess(nm, ["-S", "-C", "candidate.o"], work, timeoutMs).pipe(
          Effect.catch((err) =>
            Effect.succeed({
              code: 1,
              stdout: "",
              stderr: String(err)
            } satisfies RunResult)
          )
        )
        const resolved = resolveEntrySymbol(
          sizedNm.stdout,
          demangledNm.stdout,
          job.entrySymbol
        )
        if (resolved !== undefined) {
          entrySymbol = resolved
          size = symbolSize(sizedNm.stdout, resolved)
        }
      }
      if (size === undefined) {
        return {
          matched: false,
          score: 0,
          originalInsns: 0,
          equalInsns: 0,
          compilerOk: true,
          diagnostics: truncate(
            `entry symbol '${entrySymbol}' not found in candidate.o\n${sizedNm.stdout || sizedNm.stderr}`
          ),
          toolchainDigest,
          canonicalSha256: createHash("sha256").update("").digest("hex")
        }
      }

      const candidateDump = yield* runProcess(
        objdump,
        ["-d", "-r", "candidate.o"],
        work,
        timeoutMs
      ).pipe(
        Effect.catch((err) =>
          Effect.succeed({
            code: 1,
            stdout: "",
            stderr: String(err)
          } satisfies RunResult)
        )
      )
      if (candidateDump.code !== 0) {
        return {
          matched: false,
          score: 0,
          originalInsns: 0,
          equalInsns: 0,
          compilerOk: true,
          diagnostics: truncate(`objdump failed:\n${candidateDump.stderr}`),
          toolchainDigest,
          canonicalSha256: createHash("sha256").update("").digest("hex")
        }
      }

      const extracted = extractSymbolMachineCode(candidateDump.stdout, entrySymbol, size)
      if (!extracted.ok) {
        return {
          matched: false,
          score: 0,
          originalInsns: size,
          equalInsns: 0,
          compilerOk: true,
          diagnostics: truncate(`${extracted.reason}\n${candidateDump.stdout}`),
          toolchainDigest,
          canonicalSha256: createHash("sha256").update("").digest("hex")
        }
      }

      const original = new Uint8Array(Buffer.from(job.originalBytesBase64, "base64"))
      const scored = scoreMaskedBytes(original, extracted.bytes, extracted.relocations)
      if ("reason" in scored) {
        return {
          matched: false,
          score: 0,
          originalInsns: original.length,
          equalInsns: 0,
          compilerOk: true,
          diagnostics: truncate(scored.reason),
          toolchainDigest,
          canonicalSha256: createHash("sha256").update("").digest("hex")
        }
      }

      const diagnostics = scored.matched
        ? "normalized byte match"
        : truncate(
          [
            `score=${scored.score.toFixed(5)} equal=${scored.equalBytes}/${scored.originalBytes} bytes`,
            "--- original (masked) ---",
            ...scored.originalLines.slice(0, 80),
            "--- candidate (masked) ---",
            ...scored.candidateLines.slice(0, 80)
          ].join("\n")
        )

      const canonicalSha256 = createHash("sha256")
        .update(scored.originalLines.join("\n"))
        .update("\n--\n")
        .update(scored.candidateLines.join("\n"))
        .digest("hex")

      return {
        matched: scored.matched,
        score: scored.score,
        originalInsns: scored.originalBytes,
        equalInsns: scored.equalBytes,
        compilerOk: true,
        diagnostics,
        toolchainDigest,
        canonicalSha256
      }
    }).pipe(Effect.ensuring(cleanup))
  }).pipe(Effect.orDie)
