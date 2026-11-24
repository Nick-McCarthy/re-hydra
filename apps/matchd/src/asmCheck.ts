import { readFile } from "node:fs/promises"
import * as path from "node:path"
import { Effect } from "effect"
import { planAgbccCompile } from "./drivers/agbccPlan.js"
import {
  type AsmHit,
  findInlineAsmInPreprocessed,
  findInlineAsmInSource,
  preprocessCommand
} from "./inlineAsm.js"
import { runProcess } from "./proc.js"

export type AsmScan =
  | { readonly ok: true; readonly hit: AsmHit | undefined }
  | { readonly ok: false; readonly reason: string }

/**
 * Preprocess `sourceFile` in `work` with the target's own preprocessor (in the
 * sandbox, like a compile) and look for inline assembly in the lines that come
 * from `sourceFile` or `types.h` (audit A-032). For CodeWarrior, whose
 * compiler cannot preprocess, the raw source and `types.h` are also scanned,
 * because the GNU preprocessor only approximates its predefined macros.
 */
export const scanInlineAsm = (options: {
  readonly compiler: string
  readonly flags: ReadonlyArray<string>
  readonly sourceFile: string
  readonly work: string
  readonly timeoutMs: number
  readonly rawSources: ReadonlyArray<{ readonly name: string; readonly text: string }>
}): Effect.Effect<AsmScan> =>
  Effect.gen(function*() {
    const stem = options.sourceFile.replace(/\.[^.]+$/, "")
    const outFile = `${stem}.asmcheck.i`
    const command = preprocessCommand(
      options.compiler,
      options.flags,
      options.sourceFile,
      outFile,
      (argv) => {
        const plan = planAgbccCompile(argv, process.env)
        return plan.ok ? plan.cpp : undefined
      },
      process.env
    )
    if ("error" in command) return { ok: false, reason: command.error }

    if (command.approximate) {
      for (const source of options.rawSources) {
        const hit = findInlineAsmInSource(source.name, source.text)
        if (hit !== undefined) return { ok: true, hit }
      }
    }

    const run = yield* runProcess(command.cmd, command.args, options.work, options.timeoutMs).pipe(
      Effect.catch((error) => Effect.succeed({ code: 1, stdout: "", stderr: String(error) }))
    )
    if (run.code !== 0) {
      return { ok: false, reason: `preprocess failed:\n${run.stderr || run.stdout}` }
    }
    const text = yield* Effect.tryPromise({
      try: () => readFile(path.join(options.work, outFile), "utf8"),
      catch: (cause) => String(cause)
    }).pipe(Effect.option)
    if (text._tag === "None") return { ok: false, reason: "preprocess wrote no output" }
    return { ok: true, hit: findInlineAsmInPreprocessed(text.value, [options.sourceFile, "types.h"]) }
  })

export const inlineAsmRefusal = (hit: AsmHit): string =>
  `inline assembly is not allowed for this chunk: ${hit.file}:${hit.line}: ${hit.text}\n` +
  "A project owner or maintainer can allow inline assembly for this chunk. Matches that use it are marked."
