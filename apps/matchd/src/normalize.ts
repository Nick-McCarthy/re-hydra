/**
 * Isolated match compares machine code, not objdump mnemonics.
 * Relocation fields from the object file are blanked on both sides so a
 * linked call displacement can match an unlinked one. Opcode bytes stay.
 */

const RELOCATION_WIDTH: Readonly<Record<string, number>> = {
  R_X86_64_8: 1,
  R_X86_64_PC8: 1,
  R_X86_64_16: 2,
  R_X86_64_PC16: 2,
  R_X86_64_32: 4,
  R_X86_64_32S: 4,
  R_X86_64_PC32: 4,
  R_X86_64_PLT32: 4,
  R_X86_64_GOTPCREL: 4,
  R_X86_64_GOTPCRELX: 4,
  R_X86_64_REX_GOTPCRELX: 4,
  R_X86_64_TLSGD: 4,
  R_X86_64_GOTTPOFF: 4,
  R_X86_64_64: 8,
  R_386_8: 1,
  R_386_PC8: 1,
  R_386_16: 2,
  R_386_PC16: 2,
  R_386_32: 4,
  R_386_PC32: 4,
  R_386_PLT32: 4,
  R_386_GOT32: 4,
  R_386_GOTOFF: 4,
  R_386_GOTPC: 4
}

export type Relocation = {
  readonly offset: number
  readonly type: string
}

export type MaskedCompare = {
  readonly matched: boolean
  readonly score: number
  readonly originalBytes: number
  readonly equalBytes: number
  readonly originalLines: ReadonlyArray<string>
  readonly candidateLines: ReadonlyArray<string>
}

export const relocationWidth = (type: string): number | undefined =>
  RELOCATION_WIDTH[type]

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const symbolHeader = (symbol: string): RegExp =>
  new RegExp(`^([0-9a-fA-F]+)\\s+<${escapeRegExp(symbol)}>:`)

/** Byte length of a relocation field. Unknown types are rejected by the caller. */
const parseHexByte = (token: string): number | undefined =>
  /^[0-9a-fA-F]{2}$/.test(token) ? Number.parseInt(token, 16) : undefined

/**
 * Take `size` bytes of one symbol from `objdump -d -r`, plus relocations
 * whose fields sit entirely inside that range. Padding after the symbol is
 * ignored. A gap inside the symbol is an error.
 */
export const extractSymbolMachineCode = (
  dump: string,
  symbol: string,
  size: number
):
  | { readonly ok: true; readonly bytes: Uint8Array; readonly relocations: ReadonlyArray<Relocation> }
  | { readonly ok: false; readonly reason: string } => {
  if (size < 1) {
    return { ok: false, reason: `symbol ${symbol} has no size` }
  }
  const lines = dump.split(/\r?\n/)
  let header = -1
  let start = 0
  const headerRes = [symbolHeader(symbol), symbolHeader(`_${symbol}`)]
  for (const headerRe of headerRes) {
    for (let i = 0; i < lines.length; i++) {
      const match = headerRe.exec(lines[i] ?? "")
      if (match?.[1] !== undefined) {
        header = i
        start = Number.parseInt(match[1], 16)
        break
      }
    }
    if (header >= 0) break
  }
  if (header < 0) {
    return { ok: false, reason: `entry symbol '${symbol}' not found` }
  }

  const end = start + size
  const bytes: number[] = []
  const relocations: Array<Relocation> = []
  let cursor = start

  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (/^[0-9a-fA-F]+\s+<[^>]+>:/.test(line)) break

    const reloc = /^\s+([0-9a-fA-F]+):\s+(R_\S+)/.exec(line)
    if (reloc?.[1] !== undefined && reloc[2] !== undefined) {
      const offset = Number.parseInt(reloc[1], 16) - start
      const type = reloc[2]
      const width = relocationWidth(type)
      if (width === undefined) {
        return { ok: false, reason: `unsupported relocation ${type}` }
      }
      if (offset < 0 || offset + width > size) {
        return {
          ok: false,
          reason: `relocation ${type} at ${offset} does not fit in ${size} bytes`
        }
      }
      relocations.push({ offset, type })
      continue
    }

    const insn = /^\s*([0-9a-fA-F]+):\s+(.*)$/.exec(line)
    if (insn?.[1] === undefined || insn[2] === undefined) continue
    const address = Number.parseInt(insn[1], 16)
    if (address >= end) continue
    const tokens = insn[2].trim().split(/\s+/)
    const insnBytes: number[] = []
    for (const token of tokens) {
      const byte = parseHexByte(token)
      if (byte === undefined) break
      insnBytes.push(byte)
    }
    if (insnBytes.length === 0) continue
    if (address < start || address !== cursor) {
      return {
        ok: false,
        reason: `gap in '${symbol}' at 0x${address.toString(16)}`
      }
    }
    if (address + insnBytes.length > end) {
      return {
        ok: false,
        reason: `instruction at 0x${address.toString(16)} extends past '${symbol}'`
      }
    }
    bytes.push(...insnBytes)
    cursor = address + insnBytes.length
  }

  if (bytes.length !== size) {
    return {
      ok: false,
      reason: `disassembly of '${symbol}' is ${bytes.length} bytes, symbol is ${size}`
    }
  }
  return { ok: true, bytes: Uint8Array.from(bytes), relocations }
}

const blank = (
  bytes: Uint8Array,
  relocations: ReadonlyArray<Relocation>
): { readonly bytes: Uint8Array; readonly masked: ReadonlyArray<boolean> } | { readonly reason: string } => {
  const out = new Uint8Array(bytes)
  const masked = Array.from({ length: bytes.length }, () => false)
  for (const relocation of relocations) {
    const width = relocationWidth(relocation.type)
    if (width === undefined) {
      return { reason: `unsupported relocation ${relocation.type}` }
    }
    if (relocation.offset < 0 || relocation.offset + width > out.length) {
      continue
    }
    for (let i = 0; i < width; i++) {
      const index = relocation.offset + i
      out[index] = 0
      masked[index] = true
    }
  }
  return { bytes: out, masked }
}

const hexLines = (bytes: Uint8Array, masked: ReadonlyArray<boolean>): Array<string> =>
  [...bytes].map((byte, index) => (masked[index] === true ? "??" : byte.toString(16).padStart(2, "0")))

/** Blank relocation fields, then compare. Different lengths do not match. */
export const scoreMaskedBytes = (
  original: Uint8Array,
  candidate: Uint8Array,
  relocations: ReadonlyArray<Relocation>
): MaskedCompare | { readonly reason: string } => {
  if (original.length === 0) {
    return {
      matched: false,
      score: 0,
      originalBytes: 0,
      equalBytes: 0,
      originalLines: [],
      candidateLines: []
    }
  }
  const left = blank(original, relocations)
  if ("reason" in left) return left
  const right = blank(candidate, relocations)
  if ("reason" in right) return right

  const comparable = Math.min(left.bytes.length, right.bytes.length)
  let equalBytes = 0
  for (let i = 0; i < comparable; i++) {
    if (left.bytes[i] === right.bytes[i]) equalBytes += 1
  }
  const matched =
    left.bytes.length === right.bytes.length && equalBytes === left.bytes.length
  return {
    matched,
    score: equalBytes / original.length,
    originalBytes: original.length,
    equalBytes,
    originalLines: hexLines(left.bytes, left.masked),
    candidateLines: hexLines(right.bytes, right.masked)
  }
}
