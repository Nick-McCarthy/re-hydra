import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { Config, Effect } from "effect"
import { inlineAsmRefusal, scanInlineAsm } from "./asmCheck.js"
import type { MatchJobRequest } from "./domain/Job.js"
import { checkFlags, describeRefusal } from "./flagPolicy.js"
import { disassemblySize, extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"
import { runProcess, truncate, type RunResult } from "./proc.js"
import { maxFunctionSourceBytes, maxHeadersBytes } from "./sandbox.js"
import { resolveEntrySymbol, symbolSize } from "./symbols.js"
import { resolveTarget } from "./targets/registry.js"
import { sameCompiler } from "./toolchain.js"
import { resolveToolchain } from "./toolchains/resolve.js"

export type MatchEngineResult = {
  readonly matched: boolean
  readonly score: number
  readonly originalInsns: number
  readonly equalInsns: number
  readonly compilerOk: boolean
  readonly diagnostics: string
  readonly toolchainDigest: string
  readonly canonicalSha256: string
  /** True when the candidate contains inline assembly (audit A-032). */
  readonly usesInlineAsm?: boolean
}

export const runMatchJob = (
  job: MatchJobRequest
): Effect.Effect<MatchEngineResult> =>
  Effect.gen(function*() {
    const language = job.language ?? "c"
    const timeoutMs = yield* Config.Int("MATCHD_TIMEOUT_MS").pipe(
      Config.withDefault(30_000)
    )
    const candidateFile = language === "cpp" ? "candidate.cpp" : "candidate.c"
    const flags = [...(job.flags ?? job.toolchain.flags)]
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

    const target = resolveTarget(job.toolchain.image)
    if (target === undefined) {
      return refused(
        `no matchd target for image ${job.toolchain.image}`,
        "sha256:v2:unavailable"
      )
    }
    // Audit A-013: owner-chosen flags must be on the allow-list for this
    // compiler family before anything runs.
    const flagCheck = checkFlags(target.pin, flags)
    if (!flagCheck.ok) {
      return refused(describeRefusal(flagCheck), "sha256:v2:unavailable")
    }
    const compilerSpec = language === "cpp" ? target.tools.cpp : target.tools.c
    if (compilerSpec === undefined) {
      return refused(`${target.id} does not compile ${language}`, "sha256:v2:unavailable")
    }
    const compiler = yield* Config.String(compilerSpec.env).pipe(
      Config.withDefault(compilerSpec.fallback)
    )
    const objdump = yield* Config.String(target.tools.objdump.env).pipe(
      Config.withDefault(target.tools.objdump.fallback)
    )
    const nm = yield* Config.String(target.tools.nm.env).pipe(
      Config.withDefault(target.tools.nm.fallback)
    )

    const version = yield* runProcess(compiler, ["--version"], process.cwd(), timeoutMs).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          code: 1,
          stdout: "",
          stderr: String(err)
        } satisfies RunResult)
      )
    )

    if (version.code !== 0) {
      return refused(
        `${compiler} unavailable: ${version.stderr || version.stdout}`,
        "sha256:v2:unavailable"
      )
    }

    const resolved = yield* resolveToolchain(
      target.pin,
      compiler,
      language,
      flags,
      process.cwd(),
      timeoutMs
    )
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

    for (const file of job.sources) {
      const bytes = Buffer.byteLength(file.text, "utf8")
      const name = path.basename(file.path)
      const limit = name === "types.h" ? maxHeadersBytes : maxFunctionSourceBytes
      if (bytes > limit) {
        return refused(`${name} exceeds ${limit} bytes`, toolchainDigest)
      }
    }

    const work = yield* Effect.tryPromise({
      try: () => mkdtemp(path.join(tmpdir(), "rehydra-match-")),
      catch: (cause) => new Error(String(cause))
    }).pipe(Effect.orDie)

    const cleanup = Effect.tryPromise({
      try: () => rm(work, { recursive: true, force: true }),
      catch: () => undefined
    }).pipe(Effect.ignore)

    let usesInlineAsm = false
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

      // Audit A-032: inline assembly can reproduce the original bytes with no
      // translation. Reject it unless this chunk allows it, and report it either way.
      const asm = yield* scanInlineAsm({
        compiler,
        flags,
        sourceFile: candidateFile,
        work,
        timeoutMs,
        rawSources: job.sources.map((s) => ({ name: path.basename(s.path), text: s.text }))
      })
      if (!asm.ok) {
        return {
          matched: false,
          score: 0,
          originalInsns: 0,
          equalInsns: 0,
          compilerOk: false,
          diagnostics: truncate(asm.reason),
          toolchainDigest,
          canonicalSha256: createHash("sha256").update("").digest("hex")
        }
      }
      usesInlineAsm = asm.hit !== undefined
      if (asm.hit !== undefined && job.allowInlineAsm !== true) {
        return {
          matched: false,
          score: 0,
          originalInsns: 0,
          equalInsns: 0,
          compilerOk: false,
          diagnostics: truncate(inlineAsmRefusal(asm.hit)),
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
      let dumpStdout = ""
      const coffWithoutSize =
        target.objectFormat === "coff-objdump" && (size === undefined || size === 0)
      if (size === undefined && !coffWithoutSize) {
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
      dumpStdout = candidateDump.stdout
      if (coffWithoutSize) {
        const measured = disassemblySize(dumpStdout, entrySymbol, target.endian)
        if (measured === undefined || measured < 1) {
          return {
            matched: false,
            score: 0,
            originalInsns: 0,
            equalInsns: 0,
            compilerOk: true,
            diagnostics: truncate(
              `entry symbol '${entrySymbol}' has no COFF size\n${dumpStdout || sizedNm.stdout}`
            ),
            toolchainDigest,
            canonicalSha256: createHash("sha256").update("").digest("hex")
          }
        }
        size = measured
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

      const extracted = extractSymbolMachineCode(
        dumpStdout,
        entrySymbol,
        size,
        target.family.relocationWidth,
        target.endian
      )
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
      const scored = scoreMaskedBytes(
        original,
        extracted.bytes,
        extracted.relocations,
        target.family.relocationWidth,
        target.endian
      )
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
    }).pipe(
      Effect.map((result): MatchEngineResult => ({ ...result, usesInlineAsm })),
      Effect.ensuring(cleanup)
    )
  }).pipe(Effect.orDie)
