import { allRelocationWidths } from "./families/index.js"
import type { RelocField } from "./families/types.js"

/**
 * Isolated match compares machine code, not objdump mnemonics.
 * Relocation fields from the object file are blanked on both sides so a
 * linked address can match an unlinked one. Only the bits a relocation can
 * change are blanked. Opcode and register bits stay, even when they share a
 * byte with the address field.
 * Widths come from the job's CPU family. Callers that omit them use every
 * registered family, which is what the unit tests do.
 */

export type ObjectEndian = "little" | "big"

type RelocationWidths = Readonly<Record<string, RelocField>>

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

export const relocationWidth = (
  type: string,
  widths: RelocationWidths = allRelocationWidths()
): RelocField | undefined => widths[type]

const fieldSpan = (field: RelocField): number => (typeof field === "number" ? field : field.span)

type BlankByte = { readonly at: number; readonly bits: number }

/** Spread one unit's bit mask over its bytes in memory order. */
const unitBytes = (
  at: number,
  unit: number,
  fieldBits: number,
  endian: ObjectEndian
): Array<BlankByte> => {
  const out: Array<BlankByte> = []
  for (let k = 0; k < unit; k++) {
    const shift = endian === "big" ? (unit - 1 - k) * 8 : k * 8
    const bits = Math.floor(fieldBits / 2 ** shift) & 0xff
    if (bits !== 0) out.push({ at: at + k, bits })
  }
  return out
}

/** Bits to blank in each byte, relative to the relocation offset. */
const blankParts = (field: RelocField, endian: ObjectEndian): ReadonlyArray<BlankByte> => {
  if (typeof field === "number") {
    return Array.from({ length: field }, (_, at) => ({ at, bits: 0xff }))
  }
  if ("immediateBits" in field) {
    return unitBytes(0, field.span, 2 ** field.immediateBits - 1, endian)
  }
  return field.fieldBits.flatMap((bits, index) =>
    unitBytes(index * field.unit, field.unit, bits, endian)
  )
}

/** "leaf-0x4" or "leaf+0x10" to "leaf". */
const symbolName = (text: string | undefined): string | undefined => {
  if (text === undefined || text.length === 0) return undefined
  const name = text.replace(/[+-]0x[0-9a-fA-F]+$/, "")
  return name.length === 0 ? undefined : name
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const symbolHeader = (symbol: string): RegExp =>
  new RegExp(`^([0-9a-fA-F]+)\\s+<${escapeRegExp(symbol)}>:`)

/**
 * `<name>` is the ELF text symbol. `<_name>` is the i386 COFF form.
 * `<.name>` is the label objdump prints for an ELFv1 function whose symbol
 * lives in `.opd` rather than `.text`.
 */
const findSymbolHeader = (
  lines: ReadonlyArray<string>,
  symbol: string
): { readonly header: number; readonly start: number } | undefined => {
  for (const name of [symbol, `_${symbol}`, `.${symbol}`]) {
    const headerRe = symbolHeader(name)
    for (let i = 0; i < lines.length; i++) {
      const match = headerRe.exec(lines[i] ?? "")
      if (match?.[1] !== undefined) {
        return { header: i, start: Number.parseInt(match[1], 16) }
      }
    }
  }
  return undefined
}

/**
 * One objdump hex group, in memory order.
 * x86 prints one byte (`48`). ARM and MIPS print the instruction integer
 * (`b500`, `3c020000`). Little-endian memory stores that integer reversed.
 * A token that is not hex ends the byte list.
 */
const parseHexGroup = (token: string, endian: ObjectEndian): ReadonlyArray<number> | undefined => {
  if (!/^[0-9a-fA-F]+$/.test(token) || token.length % 2 !== 0 || token.length > 8) {
    return undefined
  }
  const bytes: number[] = []
  if (endian === "big") {
    for (let i = 0; i < token.length; i += 2) {
      bytes.push(Number.parseInt(token.slice(i, i + 2), 16))
    }
  } else {
    for (let i = token.length; i > 0; i -= 2) {
      bytes.push(Number.parseInt(token.slice(i - 2, i), 16))
    }
  }
  return bytes
}

/**
 * Bytes of one instruction. Objdump prints 2, 4, or 8 hex digits per group,
 * separated by one space. The mnemonic follows a wider gap, so a name such
 * as `fadd` is not read as another group.
 */
const instructionBytes = (rest: string, endian: ObjectEndian): ReadonlyArray<number> => {
  const bytes: number[] = []
  let i = 0
  while (rest[i] === " " || rest[i] === "\t") i++
  while (i < rest.length) {
    const match = /^([0-9a-fA-F]{8}|[0-9a-fA-F]{4}|[0-9a-fA-F]{2})/.exec(rest.slice(i))
    if (match?.[1] === undefined) break
    const group = parseHexGroup(match[1], endian)
    if (group === undefined) break
    bytes.push(...group)
    i += match[1].length
    const next = rest[i + 1]
    if (rest[i] !== " " || next === " " || next === undefined || !/[0-9a-fA-F]/.test(next)) break
    i += 1
  }
  return bytes
}

/**
 * Take `size` bytes of one symbol from `objdump -d -r`, plus relocations
 * whose fields sit entirely inside that range. Padding after the symbol is
 * ignored. A gap inside the symbol is an error.
 */
export const extractSymbolMachineCode = (
  dump: string,
  symbol: string,
  size: number,
  widths: RelocationWidths = allRelocationWidths(),
  endian: ObjectEndian = "little"
):
  | {
    readonly ok: true
    readonly bytes: Uint8Array
    readonly relocations: ReadonlyArray<Relocation>
    /**
     * The symbol each relocation refers to, by the same index, without its
     * addend ("leaf-0x4" gives "leaf"). Undefined when objdump printed none.
     * Used to check call targets (audit A-007).
     */
    readonly relocationSymbols: ReadonlyArray<string | undefined>
  }
  | { readonly ok: false; readonly reason: string } => {
  if (size < 1) {
    return { ok: false, reason: `symbol ${symbol} has no size` }
  }
  const lines = dump.split(/\r?\n/)
  const found = findSymbolHeader(lines, symbol)
  if (found === undefined) {
    return { ok: false, reason: `entry symbol '${symbol}' not found` }
  }
  const { header, start } = found

  const end = start + size
  const bytes: number[] = []
  const relocations: Array<Relocation> = []
  const relocationSymbols: Array<string | undefined> = []
  let cursor = start

  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (/^[0-9a-fA-F]+\s+<[^>]+>:/.test(line)) break

    const reloc = /^\s+([0-9a-fA-F]+):\s+((?:R_|IMAGE_REL_)\S+)(?:\s+(\S+))?/.exec(line)
    if (reloc?.[1] !== undefined && reloc[2] !== undefined) {
      const offset = Number.parseInt(reloc[1], 16) - start
      const type = reloc[2]
      const field = relocationWidth(type, widths)
      if (field === undefined) {
        return { ok: false, reason: `unsupported relocation ${type}` }
      }
      const span = fieldSpan(field)
      if (offset < 0 || offset + span > size) {
        return {
          ok: false,
          reason: `relocation ${type} at ${offset} does not fit in ${size} bytes`
        }
      }
      relocations.push({ offset, type })
      relocationSymbols.push(symbolName(reloc[3]))
      continue
    }

    const insn = /^\s*([0-9a-fA-F]+):\s+(.*)$/.exec(line)
    if (insn?.[1] === undefined || insn[2] === undefined) continue
    const address = Number.parseInt(insn[1], 16)
    if (address >= end) continue
    const insnBytes = instructionBytes(insn[2], endian)
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
  return { ok: true, bytes: Uint8Array.from(bytes), relocations, relocationSymbols }
}

/**
 * Byte length of one symbol in a dump whose symbol table stores no size.
 * COFF `nm` reports size 0. The bytes run from the symbol header to the next one.
 */
export const disassemblySize = (
  dump: string,
  symbol: string,
  endian: ObjectEndian = "little"
): number | undefined => {
  const lines = dump.split(/\r?\n/)
  const found = findSymbolHeader(lines, symbol)
  if (found === undefined) return undefined
  const { header, start } = found

  let cursor = start
  let seen = false
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i] ?? ""
    if (/^[0-9a-fA-F]+\s+<[^>]+>:/.test(line)) break
    if (/^\s+[0-9a-fA-F]+:\s+(?:R_|IMAGE_REL_)\S+/.test(line)) continue
    const insn = /^\s*([0-9a-fA-F]+):\s+(.*)$/.exec(line)
    if (insn?.[1] === undefined || insn[2] === undefined) continue
    const address = Number.parseInt(insn[1], 16)
    const insnBytes = instructionBytes(insn[2], endian)
    if (insnBytes.length === 0) continue
    if (address !== cursor) return undefined
    cursor = address + insnBytes.length
    seen = true
  }
  return seen ? cursor - start : undefined
}

const blank = (
  bytes: Uint8Array,
  relocations: ReadonlyArray<Relocation>,
  widths: RelocationWidths,
  endian: ObjectEndian
): { readonly bytes: Uint8Array; readonly masked: ReadonlyArray<number> } | { readonly reason: string } => {
  const out = new Uint8Array(bytes)
  const masked = Array.from({ length: bytes.length }, () => 0)
  for (const relocation of relocations) {
    const field = relocationWidth(relocation.type, widths)
    if (field === undefined) {
      return { reason: `unsupported relocation ${relocation.type}` }
    }
    for (const part of blankParts(field, endian)) {
      const index = relocation.offset + part.at
      if (index < 0 || index >= out.length) continue
      out[index] = (out[index] ?? 0) & ~part.bits & 0xff
      masked[index] = (masked[index] ?? 0) | part.bits
    }
  }
  return { bytes: out, masked }
}

/** Blank relocation fields in a copy of `bytes`. */
export const maskBytes = (
  bytes: Uint8Array,
  relocations: ReadonlyArray<Relocation>,
  widths: RelocationWidths = allRelocationWidths(),
  endian: ObjectEndian = "little"
): Uint8Array | { readonly reason: string } => {
  const result = blank(bytes, relocations, widths, endian)
  return "reason" in result ? result : result.bytes
}

/**
 * A blanked nibble prints as `?`. A nibble with some bits blanked prints the
 * bits that are left, so `48` under a branch mask still shows the opcode.
 */
const hexByte = (byte: number, bits: number): string =>
  [4, 0]
    .map((shift) => {
      const nibbleBits = (bits >> shift) & 0xf
      if (nibbleBits === 0xf) return "?"
      return (((byte >> shift) & 0xf) & ~nibbleBits).toString(16)
    })
    .join("")

const hexLines = (bytes: Uint8Array, masked: ReadonlyArray<number>): Array<string> =>
  [...bytes].map((byte, index) => hexByte(byte, masked[index] ?? 0))

/** Blank relocation fields, then compare. Different lengths do not match. */
export const scoreMaskedBytes = (
  original: Uint8Array,
  candidate: Uint8Array,
  relocations: ReadonlyArray<Relocation>,
  widths: RelocationWidths = allRelocationWidths(),
  endian: ObjectEndian = "little"
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
  const left = blank(original, relocations, widths, endian)
  if ("reason" in left) return left
  const right = blank(candidate, relocations, widths, endian)
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
