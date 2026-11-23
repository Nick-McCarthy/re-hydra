import type { CpuFamily } from "./types.js"

/**
 * ARM ELF relocation widths, shared by GBA, DS, and 3DS.
 *
 * `R_ARM_CALL` / `R_ARM_JUMP24` / `R_ARM_PC24` sit on a 4-byte ARM instruction.
 * The branch immediate is the low 24 bits, so the first three little-endian
 * bytes are the address and the fourth byte is the opcode.
 *
 * Thumb `BL` splits its immediate across both halfwords, mixed with opcode
 * bits. Those relocations blank only the immediate bits of each halfword,
 * plus the BL/BLX bit the linker may flip. `MOVW` and `MOVT` blank the
 * 16-bit immediate and keep the opcode and destination register.
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
    R_ARM_THM_CALL: { span: 4, unit: 2, fieldBits: [0x07ff, 0x3fff] },
    R_ARM_THM_JUMP11: { span: 2, unit: 2, fieldBits: [0x07ff] },
    R_ARM_THM_PC8: { span: 2, unit: 2, fieldBits: [0x00ff] },
    R_ARM_CALL: 3,
    R_ARM_JUMP24: 3,
    R_ARM_THM_JUMP24: { span: 4, unit: 2, fieldBits: [0x07ff, 0x3fff] },
    R_ARM_PREL31: 4,
    R_ARM_MOVW_ABS_NC: { span: 4, unit: 4, fieldBits: [0x000f0fff] },
    R_ARM_MOVT_ABS: { span: 4, unit: 4, fieldBits: [0x000f0fff] },
    R_ARM_THM_MOVW_ABS_NC: { span: 4, unit: 2, fieldBits: [0x040f, 0x70ff] },
    R_ARM_THM_MOVT_ABS: { span: 4, unit: 2, fieldBits: [0x040f, 0x70ff] },
    R_ARM_V4BX: 0
  }
}
