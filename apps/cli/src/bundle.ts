import { mkdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import type { WorkBundle } from "@re-hydra/api/domain/Bundle"
import { Effect } from "effect"

export const writeWorkBundle = (
  workDir: string,
  bundle: WorkBundle
): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(workDir, { recursive: true })
    const write = (name: string, contents: string | Buffer) => {
      writeFileSync(path.join(workDir, name), contents)
    }
    write("chunk.json", `${JSON.stringify(bundle.meta, null, 2)}\n`)
    write("original.bin", Buffer.from(bundle.originalBytesBase64, "base64"))
    write("pseudocode.c", bundle.pseudocode)
    write("disassembly.s", bundle.disassembly)
    write("types.h", bundle.types)
    write("neighbors.json", `${JSON.stringify(bundle.neighbors, null, 2)}\n`)
    write("instructions.agent", bundle.agentInstructions)
    if (bundle.integrationNote !== undefined) {
      write("integration.txt", bundle.integrationNote)
    }
    if (bundle.bestAttemptSource !== undefined) {
      write("attempt.c", bundle.bestAttemptSource)
    }
    write(
      "candidate.c",
      bundle.bestAttemptSource ??
        `/* translate ${bundle.meta.name} — submit with: hydra submit */\n`
    )
  })

export const workDirFor = (
  projectSlug: string,
  chunkName: string,
  cwd = process.cwd()
): string => {
  const safeName = chunkName.replace(/[^\w.-]+/g, "_")
  return path.join(cwd, "chunks", projectSlug, safeName)
}
