import type { ObjectEndian } from "./normalize.js"

/**
 * Audit A-007. A normalized match blanks relocated fields on both sides, so
 * on its own it cannot tell `call foo` from `call bar`. The original function
 * is already linked, so the address it uses at each relocated field can be
 * decoded from its bytes. matchd reports that address next to the symbol the
 * candidate uses there, and the API compares the two against the project's
 * functions.
 *
 * Decoded here (P is the address of the relocated field in the original):
 * - x86 and x86-64 rel32 (call, jmp, rip-relative): P + 4 + disp32
 * - ARM B/BL (imm24): P + 8 + (imm24 << 2), plus the H bit for BLX
 * - Thumb BL/BLX/B.W (split immediate): P + 4 + imm
 * - AArch64 B/BL (imm26): P + (imm26 << 2)
 * - MIPS j/jal (26-bit, region of the next instruction): ((P + 4) & ~0x0fffffff) | (imm26 << 2)
 * - PowerPC b/bl (LI, AA): AA ? LI : P + LI
 * - absolute 32- and 64-bit address words (literal pools, pointers, data)
 *
 * Other relocation types (high/low halves, GOT, small-data) give undefined and
 * are not checked.
 */

const rel32 = new Set([
  "R_X86_64_PC32", "R_X86_64_PLT32", "R_386_PC32", "R_386_PLT32",
  "IMAGE_REL_AMD64_REL32", "IMAGE_REL_I386_REL32"
])
const abs32 = new Set([
  "R_386_32", "R_X86_64_32", "R_X86_64_32S", "IMAGE_REL_I386_DIR32", "IMAGE_REL_AMD64_ADDR32",
  "R_ARM_ABS32", "R_AARCH64_ABS32", "R_MIPS_32", "R_PPC_ADDR32", "IMAGE_REL_PPC_ADDR32",
  "R_SH_DIR32", "R_68K_32"
])
const abs64 = new Set(["R_X86_64_64", "R_AARCH64_ABS64", "IMAGE_REL_AMD64_ADDR64", "IMAGE_REL_PPC_ADDR64", "R_PPC64_ADDR64"])
const armBranch = new Set(["R_ARM_CALL", "R_ARM_JUMP24", "R_ARM_PC24"])
const thumbBranch = new Set(["R_ARM_THM_CALL", "R_ARM_THM_JUMP24"])
const a64Branch = new Set(["R_AARCH64_CALL26", "R_AARCH64_JUMP26"])
const mipsJump = new Set(["R_MIPS_26"])
const ppcBranch = new Set(["R_PPC_REL24", "R_PPC_PLTREL24", "R_PPC64_REL24", "IMAGE_REL_PPC_REL24"])

const mask32 = 0xffffffffn
const mask64 = 0xffffffffffffffffn

const readUnsigned = (bytes: Uint8Array, at: number, width: number, endian: ObjectEndian): bigint | undefined => {
  if (at < 0 || at + width > bytes.length) return undefined
  let value = 0n
  for (let i = 0; i < width; i++) {
    const index = endian === "big" ? at + i : at + width - 1 - i
    value = (value << 8n) | BigInt(bytes[index] ?? 0)
  }
  return value
}

const signExtend = (value: bigint, bits: number): bigint => {
  const sign = 1n << BigInt(bits - 1)
  return (value & (sign - 1n)) - (value & sign)
}

/** The address the original refers to at `offset`, or undefined if this type is not decoded. */
export const decodeOriginalTarget = (
  type: string,
  original: Uint8Array,
  offset: number,
  functionAddress: bigint,
  endian: ObjectEndian
): bigint | undefined => {
  const p = functionAddress + BigInt(offset)
  if (rel32.has(type)) {
    const disp = readUnsigned(original, offset, 4, "little")
    return disp === undefined ? undefined : (p + 4n + signExtend(disp, 32)) & mask64
  }
  if (abs32.has(type)) return readUnsigned(original, offset, 4, endian)
  if (abs64.has(type)) return readUnsigned(original, offset, 8, endian)
  if (armBranch.has(type)) {
    const word = readUnsigned(original, offset, 4, endian)
    if (word === undefined) return undefined
    const imm = signExtend(word & 0xffffffn, 24) << 2n
    // BLX (immediate) has condition 0b1111 and puts bit 1 of the target in H.
    const h = (word >> 28n) === 0xfn ? ((word >> 24n) & 1n) << 1n : 0n
    return (p + 8n + imm + h) & mask32
  }
  if (thumbBranch.has(type)) {
    const hw1 = readUnsigned(original, offset, 2, endian)
    const hw2 = readUnsigned(original, offset + 2, 2, endian)
    if (hw1 === undefined || hw2 === undefined) return undefined
    const s = (hw1 >> 10n) & 1n
    const imm10 = hw1 & 0x3ffn
    const j1 = (hw2 >> 13n) & 1n
    const j2 = (hw2 >> 11n) & 1n
    const imm11 = hw2 & 0x7ffn
    const i1 = (j1 ^ s) ^ 1n
    const i2 = (j2 ^ s) ^ 1n
    const imm = signExtend((s << 24n) | (i1 << 23n) | (i2 << 22n) | (imm10 << 12n) | (imm11 << 1n), 25)
    // BLX (bit 12 clear) lands on a word-aligned ARM address.
    const blx = ((hw2 >> 12n) & 1n) === 0n
    const target = p + 4n + imm
    return (blx ? target & ~3n : target) & mask32
  }
  if (a64Branch.has(type)) {
    const word = readUnsigned(original, offset, 4, endian)
    return word === undefined ? undefined : (p + (signExtend(word & 0x3ffffffn, 26) << 2n)) & mask64
  }
  if (mipsJump.has(type)) {
    const word = readUnsigned(original, offset, 4, endian)
    return word === undefined ? undefined : ((p + 4n) & ~0x0fffffffn & mask32) | ((word & 0x3ffffffn) << 2n)
  }
  if (ppcBranch.has(type)) {
    const word = readUnsigned(original, offset, 4, endian)
    if (word === undefined) return undefined
    const li = signExtend(word & 0x3fffffcn, 26)
    const absolute = (word & 2n) !== 0n
    return (absolute ? li : p + li) & (type === "R_PPC64_REL24" ? mask64 : mask32)
  }
  return undefined
}

/** Section and local names that do not name a function. */
const isAnonymous = (symbol: string): boolean =>
  /^\.(text|data|rodata|bss|sdata|sbss|sdata2|sbss2|toc|opd|got|plt|init|fini)\b/.test(symbol) ||
  symbol.startsWith(".L") || symbol.startsWith("$") || /^\.[a-z_]*\$/.test(symbol)

export type Reference = {
  readonly offset: number
  readonly type: string
  readonly symbol: string
  /** Hex, from the original's linked bytes. */
  readonly originalTarget: string
}

export const collectReferences = (
  relocations: ReadonlyArray<{ readonly offset: number; readonly type: string }>,
  symbols: ReadonlyArray<string | undefined>,
  original: Uint8Array,
  functionAddress: bigint,
  endian: ObjectEndian
): ReadonlyArray<Reference> => {
  const out: Array<Reference> = []
  relocations.forEach((relocation, index) => {
    const symbol = symbols[index]
    if (symbol === undefined || isAnonymous(symbol)) return
    const target = decodeOriginalTarget(relocation.type, original, relocation.offset, functionAddress, endian)
    if (target === undefined) return
    out.push({ offset: relocation.offset, type: relocation.type, symbol, originalTarget: `0x${target.toString(16)}` })
  })
  return out
}
