/**
 * A contiguous field that already starts at the relocation offset.
 * x86 displacements and absolute data words use this.
 */
export type RelocBytes = number

/**
 * The low bits of an instruction word. The relocation offset is the start of
 * the instruction. Endianness decides which bytes those bits occupy.
 * A width that is not a whole number of bytes blanks the whole instruction,
 * because the field shares a byte with the opcode.
 */
export type RelocImmediate = {
  readonly span: number
  readonly immediateBits: 16 | 24 | 26
}

export type RelocField = RelocBytes | RelocImmediate

/**
 * A CPU family is shared by every console that emits the same relocation names.
 * MIPS covers N64, PS1, PS2, and PSP. ARM covers GBA, DS, and 3DS.
 * AArch64 covers Switch. SuperH covers Dreamcast and Saturn.
 * 68000 covers Genesis.
 * Endianness lives on the target. A new family is a new file plus one entry
 * in `families/index.ts`.
 */
export type CpuFamily = {
  readonly id: string
  readonly relocationWidth: Readonly<Record<string, RelocField>>
}
