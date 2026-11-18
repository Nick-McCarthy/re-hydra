import type { WorkBundle } from "@/lib/api"
import { zipStore } from "@/lib/zipStore"

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

/** Same file layout as `hydra checkout`, without the local lease token. */
export function bundleFiles(bundle: WorkBundle): Array<{ name: string; data: Uint8Array }> {
  const candidate =
    bundle.bestAttemptSource ??
    `/* translate ${bundle.meta.name} — submit with: hydra submit */\n`
  const files: Array<{ name: string; data: Uint8Array }> = [
    { name: "chunk.json", data: encode(`${JSON.stringify(bundle.meta, null, 2)}\n`) },
    { name: "original.bin", data: decodeBase64(bundle.originalBytesBase64) },
    { name: "pseudocode.c", data: encode(bundle.pseudocode) },
    { name: "disassembly.s", data: encode(bundle.disassembly) },
    { name: "types.h", data: encode(bundle.types) },
    { name: "neighbors.json", data: encode(`${JSON.stringify(bundle.neighbors, null, 2)}\n`) },
    { name: "instructions.agent", data: encode(bundle.agentInstructions) },
    { name: "candidate.c", data: encode(candidate) }
  ]
  if (bundle.bestAttemptSource !== undefined) {
    files.push({ name: "attempt.c", data: encode(bundle.bestAttemptSource) })
  }
  return files
}

export function downloadWorkBundle(bundle: WorkBundle): void {
  const bytes = zipStore(bundleFiles(bundle))
  const blob = new Blob([bytes as BlobPart], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  const safeName = bundle.meta.name.replace(/[^\w.-]+/g, "_")
  link.href = url
  link.download = `${bundle.meta.projectSlug}-${safeName}.zip`
  link.click()
  URL.revokeObjectURL(url)
}
