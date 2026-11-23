import type { CpuFamily } from "./types.js"

/**
 * MIPS ELF relocations shared by N64, PS1, PS2, and PSP.
 *
 * `HI16`, `LO16`, `HIGHER`, `HIGHEST`, and `GPREL16` are the low 16 bits of a
 * 4-byte instruction. On a big-endian N64 object those bits are the last two
 * bytes, so the opcode and the registers stay. On a little-endian PS1, PS2, or PSP
 * object they are the first two.
 *
 * `R_MIPS_26` (j/jal) is 26 bits inside the same word. Only those bits are
 * blanked, so `j` and `jal` still differ in the 6 opcode bits.
 */
export const mipsFamily: CpuFamily = {
  id: "mips",
  relocationWidth: {
    R_MIPS_NONE: 0,
    R_MIPS_16: 2,
    R_MIPS_32: 4,
    R_MIPS_REL32: 4,
    R_MIPS_26: { span: 4, immediateBits: 26 },
    R_MIPS_HI16: { span: 4, immediateBits: 16 },
    R_MIPS_HIGHER: { span: 4, immediateBits: 16 },
    R_MIPS_HIGHEST: { span: 4, immediateBits: 16 },
    R_MIPS_LO16: { span: 4, immediateBits: 16 },
    R_MIPS_GPREL16: { span: 4, immediateBits: 16 },
    R_MIPS_LITERAL: { span: 4, immediateBits: 16 },
    R_MIPS_GOT16: { span: 4, immediateBits: 16 },
    R_MIPS_PC16: { span: 4, immediateBits: 16 },
    R_MIPS_CALL16: { span: 4, immediateBits: 16 },
    R_MIPS_GPREL32: 4,
    R_MIPS_JALR: 4
  }
}
