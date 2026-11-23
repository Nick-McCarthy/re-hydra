import type { CpuFamily } from "./types.js"

/**
 * PowerPC relocations shared by GameCube, Wii, Wii U, PS3, and Xbox 360.
 * `ADDR16_*` and `REL16_*` records point at the immediate halfword, two bytes
 * into the instruction, so a width of 2 leaves the opcode. `REL24`, `REL14`,
 * `ADDR24`, `ADDR14`, and `EMB_SDA21` start at the instruction and share
 * bytes with the opcode, so they blank only their field bits: the 24-bit LI
 * field (`b` vs `bl` still differs in LK), the 14-bit BD field, and the
 * rA plus 16-bit offset of SDA21 (`lwz` vs `stw` still differs). `R_PPC64_*` is the PS3
 * ELF form of the same fields. `IMAGE_REL_PPC_*` is the Xbox 360 COFF form.
 */
export const ppcFamily: CpuFamily = {
  id: "ppc",
  relocationWidth: {
    R_PPC_NONE: 0,
    R_PPC_ADDR32: 4,
    R_PPC_ADDR24: { span: 4, unit: 4, fieldBits: [0x03fffffc] },
    R_PPC_ADDR16: 2,
    R_PPC_ADDR16_LO: 2,
    R_PPC_ADDR16_HI: 2,
    R_PPC_ADDR16_HA: 2,
    R_PPC_ADDR14: { span: 4, unit: 4, fieldBits: [0x0000fffc] },
    R_PPC_REL24: { span: 4, unit: 4, fieldBits: [0x03fffffc] },
    R_PPC_REL14: { span: 4, unit: 4, fieldBits: [0x0000fffc] },
    R_PPC_REL32: 4,
    R_PPC_REL16: 2,
    R_PPC_REL16_LO: 2,
    R_PPC_REL16_HI: 2,
    R_PPC_REL16_HA: 2,
    R_PPC_PLTREL24: { span: 4, unit: 4, fieldBits: [0x03fffffc] },
    R_PPC_EMB_SDA21: { span: 4, unit: 4, fieldBits: [0x001fffff] },
    R_PPC64_REL24: { span: 4, unit: 4, fieldBits: [0x03fffffc] },
    R_PPC64_TOC16: 2,
    R_PPC64_TOC16_LO: 2,
    R_PPC64_TOC16_HI: 2,
    R_PPC64_TOC16_HA: 2,
    R_PPC64_TOC16_LO_DS: 2,
    IMAGE_REL_PPC_ABSOLUTE: 0,
    IMAGE_REL_PPC_ADDR64: 8,
    IMAGE_REL_PPC_ADDR32: 4,
    IMAGE_REL_PPC_ADDR32NB: 4,
    IMAGE_REL_PPC_ADDR24: { span: 4, unit: 4, fieldBits: [0x03fffffc] },
    IMAGE_REL_PPC_ADDR16: 2,
    IMAGE_REL_PPC_ADDR14: { span: 4, unit: 4, fieldBits: [0x0000fffc] },
    IMAGE_REL_PPC_REL24: { span: 4, unit: 4, fieldBits: [0x03fffffc] },
    IMAGE_REL_PPC_REL14: { span: 4, unit: 4, fieldBits: [0x0000fffc] },
    IMAGE_REL_PPC_TOCREL16: 2,
    IMAGE_REL_PPC_SECREL: 4,
    IMAGE_REL_PPC_SECTION: 2,
    IMAGE_REL_PPC_IFGLUE: 4,
    IMAGE_REL_PPC_IMGLUE: 4,
    IMAGE_REL_PPC_SECREL16: 2,
    IMAGE_REL_PPC_REFHI: 2,
    IMAGE_REL_PPC_REFLO: 2,
    IMAGE_REL_PPC_PAIR: 0,
    IMAGE_REL_PPC_SECRELLO: 2,
    IMAGE_REL_PPC_GPREL: 2,
    IMAGE_REL_PPC_TOKEN: 4
  }
}
