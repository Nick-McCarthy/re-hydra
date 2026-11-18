import type { CpuFamily } from "./types.js"

/**
 * Motorola 68000 ELF relocations. Genesis objects are big-endian, and objdump
 * prints each instruction as 16-bit groups already in memory order.
 * `R_68K_32` is the absolute address after an opcode such as `jsr`.
 * `R_68K_GOT16` and `R_68K_GOT16O` are 16-bit fields inside the instruction.
 * The 8, 16, and 32-bit absolute, pc-relative, GOT, and PLT forms are the
 * same field sizes.
 */
export const m68kFamily: CpuFamily = {
  id: "m68k",
  relocationWidth: {
    R_68K_NONE: 0,
    R_68K_32: 4,
    R_68K_16: 2,
    R_68K_8: 1,
    R_68K_PC32: 4,
    R_68K_PC16: 2,
    R_68K_PC8: 1,
    R_68K_GOT32: 4,
    R_68K_GOT16: 2,
    R_68K_GOT8: 1,
    R_68K_GOT32O: 4,
    R_68K_GOT16O: 2,
    R_68K_GOT8O: 1,
    R_68K_PLT32: 4,
    R_68K_PLT16: 2,
    R_68K_PLT8: 1,
    R_68K_PLT32O: 4,
    R_68K_PLT16O: 2,
    R_68K_PLT8O: 1
  }
}
