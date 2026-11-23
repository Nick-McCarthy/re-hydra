/**
 * A contiguous field that already starts at the relocation offset.
 * x86 displacements and absolute data words use this.
 */
export type RelocBytes = number

/**
 * The low bits of an instruction word. The relocation offset is the start of
 * the instruction. Endianness decides which bytes those bits occupy. Only
 * those bits are blanked, so opcode bits that share a byte with the field
 * still have to match.
 */
export type RelocImmediate = {
  readonly span: number
  readonly immediateBits: 16 | 24 | 26
}

/**
 * Bits the linker may rewrite, one mask per instruction unit, written as the
 * integer objdump prints for that unit. `unit` is 2 for each Thumb halfword
 * and 4 for a 32-bit instruction word. `span` is `unit * fieldBits.length`.
 * Every other bit (the opcode and the registers) has to match.
 */
export type RelocMask = {
  readonly span: number
  readonly unit: 2 | 4
  readonly fieldBits: ReadonlyArray<number>
}

export type RelocField = RelocBytes | RelocImmediate | RelocMask

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
