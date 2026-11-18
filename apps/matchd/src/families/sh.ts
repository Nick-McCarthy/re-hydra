import type { CpuFamily } from "./types.js"

/**
 * SuperH ELF relocations shared by Dreamcast and Saturn.
 *
 * `DIR32`, `REL32`, `GOT32`, `PLT32`, `GOTOFF`, and `GOTPC` are 32-bit slots
 * in a literal pool. The relocation offset is the first byte of the slot.
 * Instruction lines are separate bytes already in memory order.
 */
export const shFamily: CpuFamily = {
  id: "sh",
  relocationWidth: {
    R_SH_NONE: 0,
    R_SH_DIR32: 4,
    R_SH_REL32: 4,
    R_SH_GOT32: 4,
    R_SH_PLT32: 4,
    R_SH_GOTOFF: 4,
    R_SH_GOTPC: 4
  }
}
