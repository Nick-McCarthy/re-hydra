import type { CpuFamily } from "./types.js"

/**
 * AArch64 ELF relocations. Switch objects are little-endian ELF.
 * `CALL26` and `JUMP26` put a 26-bit target in the instruction, so the
 * opcode shares a byte with the field and the whole instruction is blanked.
 * `ADRP` and the `LO12` loads scatter the address through the instruction,
 * so those are blanked the same way. Absolute and PC-relative data words
 * are a plain byte width.
 */
export const aarch64Family: CpuFamily = {
  id: "aarch64",
  relocationWidth: {
    R_AARCH64_NONE: 0,
    R_AARCH64_ABS64: 8,
    R_AARCH64_ABS32: 4,
    R_AARCH64_ABS16: 2,
    R_AARCH64_PREL64: 8,
    R_AARCH64_PREL32: 4,
    R_AARCH64_PREL16: 2,
    R_AARCH64_MOVW_UABS_G0: 4,
    R_AARCH64_MOVW_UABS_G0_NC: 4,
    R_AARCH64_MOVW_UABS_G1: 4,
    R_AARCH64_MOVW_UABS_G1_NC: 4,
    R_AARCH64_MOVW_UABS_G2: 4,
    R_AARCH64_MOVW_UABS_G2_NC: 4,
    R_AARCH64_MOVW_UABS_G3: 4,
    R_AARCH64_MOVW_SABS_G0: 4,
    R_AARCH64_MOVW_SABS_G1: 4,
    R_AARCH64_MOVW_SABS_G2: 4,
    R_AARCH64_MOVW_PREL_G0: 4,
    R_AARCH64_MOVW_PREL_G0_NC: 4,
    R_AARCH64_MOVW_PREL_G1: 4,
    R_AARCH64_MOVW_PREL_G1_NC: 4,
    R_AARCH64_MOVW_PREL_G2: 4,
    R_AARCH64_MOVW_PREL_G2_NC: 4,
    R_AARCH64_MOVW_PREL_G3: 4,
    R_AARCH64_LD_PREL_LO19: 4,
    R_AARCH64_ADR_PREL_LO21: 4,
    R_AARCH64_ADR_PREL_PG_HI21: 4,
    R_AARCH64_ADR_PREL_PG_HI21_NC: 4,
    R_AARCH64_ADD_ABS_LO12_NC: 4,
    R_AARCH64_LDST8_ABS_LO12_NC: 4,
    R_AARCH64_LDST16_ABS_LO12_NC: 4,
    R_AARCH64_LDST32_ABS_LO12_NC: 4,
    R_AARCH64_LDST64_ABS_LO12_NC: 4,
    R_AARCH64_LDST128_ABS_LO12_NC: 4,
    R_AARCH64_TSTBR14: 4,
    R_AARCH64_CONDBR19: 4,
    R_AARCH64_JUMP26: { span: 4, immediateBits: 26 },
    R_AARCH64_CALL26: { span: 4, immediateBits: 26 },
    R_AARCH64_ADR_GOT_PAGE: 4,
    R_AARCH64_LD64_GOT_LO12_NC: 4
  }
}
