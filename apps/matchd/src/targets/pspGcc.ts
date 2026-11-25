import { mipsFamily } from "../families/mips.js"
import type { MatchTarget } from "./types.js"

/**
 * PlayStation Portable Allegrex, little-endian MIPS ELF.
 * The image is pspdev GCC 15.2.0. `psp-objdump` decodes Allegrex opcodes.
 * The Sony SN Systems compiler is a different binary.
 */
export const pspGcc: MatchTarget = {
  id: "psp-gcc",
  images: ["ghcr.io/re-hydra/psp-gcc:allegrex"],
  family: mipsFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_PSP_GCC", fallback: "psp-gcc" },
    cpp: { env: "MATCHD_PSP_GXX", fallback: "psp-g++" },
    nm: { env: "MATCHD_PSP_NM", fallback: "psp-nm" },
    objdump: { env: "MATCHD_PSP_OBJDUMP", fallback: "psp-objdump" },
    ld: { env: "MATCHD_PSP_LD", fallback: "psp-ld" }
  }
}
