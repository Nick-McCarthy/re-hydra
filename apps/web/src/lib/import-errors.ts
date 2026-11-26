import { ApiError } from "@/lib/api"

const overlapTail =
  "The board keeps one range per stretch of bytes. If an entry point sits inside the function body, re-run ExportReHydra so the address is the start of the body."

type Span = {
  readonly name: string
  readonly start: bigint
  readonly end: bigint
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const base64ByteLength = (value: string): number | null => {
  const cleaned = value.replace(/\s/g, "")
  if (cleaned.length === 0 || cleaned.length % 4 !== 0) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) return null
  const pad = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0
  if (cleaned.slice(0, cleaned.length - pad).includes("=")) return null
  return (cleaned.length / 4) * 3 - pad
}

const parseAddress = (value: string): bigint | null => {
  const trimmed = value.trim().toLowerCase()
  try {
    return trimmed.startsWith("0x") ? BigInt(trimmed) : BigInt(trimmed)
  } catch {
    return null
  }
}

const hexAddress = (start: bigint): string => "0x" + start.toString(16)

const describeOverlaps = (spans: ReadonlyArray<Span>): string | null => {
  const ordered = [...spans].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const lines: Array<string> = []
  let total = 0
  for (let i = 0; i < ordered.length; i++) {
    const left = ordered[i]!
    for (let k = i + 1; k < ordered.length && ordered[k]!.start < left.end; k++) {
      const right = ordered[k]!
      total += 1
      if (lines.length < 8) {
        const leftBytes = left.end - left.start
        const rightBytes = right.end - right.start
        lines.push(
          `${left.name} at ${hexAddress(left.start)} (${leftBytes} ${leftBytes === 1n ? "byte" : "bytes"}) overlaps ${right.name} at ${hexAddress(right.start)} (${rightBytes} ${rightBytes === 1n ? "byte" : "bytes"}).`
        )
      }
    }
  }
  if (total === 0) return null
  const more = total > lines.length ? `\n${total - lines.length} more overlapping pairs.` : ""
  return `${lines.join("\n")}${more}\n${overlapTail}`
}

const functionName = (row: Record<string, unknown>, index: number): string =>
  typeof row.name === "string" && row.name.trim().length > 0 ? row.name : `Function ${index + 1}`

/** A sentence the upload form can show, or null when the file can be sent. */
export function explainExport(text: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    const detail = err instanceof Error ? err.message : "it could not be parsed"
    return `This file is not JSON (${detail}). ExportReHydra writes a JSON file.`
  }
  if (!isRecord(value)) {
    return "This file is JSON, but an ExportReHydra export is an object with binarySha256, arch, types, and functions."
  }

  if (typeof value.binarySha256 !== "string") {
    return "This export is missing binarySha256, the 64-character hex hash of the binary."
  }
  if (!/^[0-9a-fA-F]{64}$/.test(value.binarySha256)) {
    return `binarySha256 has to be 64 hexadecimal characters. This one is ${value.binarySha256.length} characters.`
  }
  if (typeof value.arch !== "string" || value.arch.trim().length === 0) {
    return "This export is missing arch, the processor description from Ghidra."
  }
  if (typeof value.types !== "string") {
    return "This export is missing types. ExportReHydra always includes that field, even when it is empty."
  }
  if (value.name !== undefined && typeof value.name !== "string") {
    return "name has to be a string."
  }
  if (value.language !== undefined && typeof value.language !== "string") {
    return "language has to be a string."
  }
  if (value.binaryBase64 !== undefined) {
    return "Remove binaryBase64: re-hydra does not store whole programs (content policy 2.2). Function bytes are enough for matching, and ExportReHydra never includes it."
  }
  if (value.toolchain !== undefined) {
    if (!isRecord(value.toolchain)) {
      return "toolchain has to be an object with compiler, version, flags, and image."
    }
    const flags = value.toolchain.flags
    if (
      typeof value.toolchain.compiler !== "string" ||
      typeof value.toolchain.version !== "string" ||
      typeof value.toolchain.image !== "string" ||
      !Array.isArray(flags) ||
      flags.some((flag) => typeof flag !== "string")
    ) {
      return "toolchain has to include compiler, version, flags, and image."
    }
  }
  if (!Array.isArray(value.functions)) {
    return "This export is missing functions."
  }
  if (value.functions.length === 0) {
    return "This export has no functions."
  }

  const spans: Array<Span> = []
  for (let index = 0; index < value.functions.length; index++) {
    const fn = value.functions[index]
    if (!isRecord(fn)) {
      return `Function ${index + 1} is not an object.`
    }
    const name = functionName(fn, index)
    if (typeof fn.name !== "string" || fn.name.trim().length === 0) {
      return `Function ${index + 1} is missing its name.`
    }
    if (typeof fn.address !== "string" || fn.address.trim().length === 0) {
      return `${name} is missing its address.`
    }
    const start = parseAddress(fn.address)
    if (start === null) {
      return `${name} has address "${fn.address}", which is not a number.`
    }
    if (start < 0n) {
      return `${name} has address "${fn.address}", which is negative.`
    }
    if (typeof fn.size !== "number" || !Number.isInteger(fn.size) || fn.size <= 0) {
      return `${name} needs a size greater than 0.`
    }
    if (start + BigInt(fn.size) > 9223372036854775807n) {
      return `${name} at ${hexAddress(start)} extends past the address range this project can store.`
    }
    if (typeof fn.bytesBase64 !== "string" || fn.bytesBase64.length === 0) {
      return `${name} is missing its bytes.`
    }
    const decoded = base64ByteLength(fn.bytesBase64)
    if (decoded === null || decoded === 0) {
      return `${name} has bytes that are not valid base64.`
    }
    if (decoded !== fn.size) {
      return `${name} says it is ${fn.size} bytes, but the decoded bytes are ${decoded}.`
    }
    if (typeof fn.pseudocode !== "string") {
      return `${name} is missing pseudocode.`
    }
    if (typeof fn.disassembly !== "string") {
      return `${name} is missing disassembly.`
    }
    if (fn.callees !== undefined && (!Array.isArray(fn.callees) || fn.callees.some((item) => typeof item !== "string"))) {
      return `${name} lists callees that are not addresses.`
    }
    if (fn.typesUsed !== undefined && (!Array.isArray(fn.typesUsed) || fn.typesUsed.some((item) => typeof item !== "string"))) {
      return `${name} lists types that are not names.`
    }
    spans.push({ name, start, end: start + BigInt(fn.size) })
  }

  return describeOverlaps(spans)
}

export function importFailureMessage(err: ApiError): string {
  if (!err.message.startsWith("Request failed")) return err.message
  if (err.status === 400) {
    return "The server rejected this export. It needs binarySha256, arch, types, and functions whose byte length matches size."
  }
  if (err.status === 403) {
    return "Only an owner or maintainer can import an export into this project."
  }
  if (err.status === 404) {
    return "This project is not available."
  }
  if (err.status === 413) {
    return "This export is too large to upload."
  }
  return "The import failed on the server."
}
