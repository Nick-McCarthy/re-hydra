import type { CpuFamily } from "./types.js"

/**
 * ARM ELF relocation widths, shared by GBA, DS, and 3DS.
 *
 * `R_ARM_CALL` / `R_ARM_JUMP24` / `R_ARM_PC24` sit on a 4-byte ARM instruction.
 * The branch immediate is the low 24 bits, so the first three little-endian
 * bytes are the address and the fourth byte is the opcode.
 *
 * Thumb `BL` splits its immediate across both halfwords, mixed with opcode
 * bits, so those relocations blank the whole instruction.
 */
export const armFamily: CpuFamily = {
  id: "arm",
  relocationWidth: {
    R_ARM_NONE: 0,
    R_ARM_PC24: 3,
    R_ARM_ABS32: 4,
    R_ARM_REL32: 4,
    R_ARM_ABS16: 2,
    R_ARM_ABS8: 1,
    R_ARM_THM_CALL: 4,
    R_ARM_THM_JUMP11: 2,
    R_ARM_THM_PC8: 2,
    R_ARM_CALL: 3,
    R_ARM_JUMP24: 3,
    R_ARM_THM_JUMP24: 4,
    R_ARM_PREL31: 4,
    R_ARM_MOVW_ABS_NC: 4,
    R_ARM_MOVT_ABS: 4,
    R_ARM_THM_MOVW_ABS_NC: 4,
    R_ARM_THM_MOVT_ABS: 4,
    R_ARM_V4BX: 0
  }
}
