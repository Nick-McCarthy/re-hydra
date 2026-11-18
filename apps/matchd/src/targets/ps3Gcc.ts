import { ppcFamily } from "../families/ppc.js"
import type { MatchTarget } from "./types.js"

/**
 * PlayStation 3 Cell PPE, big-endian PowerPC64 ELF. The image is Debian
 * `powerpc64-linux-gnu-gcc`. SNC and the Cell SDK GCC are different binaries.
 * SPU code is a different processor. ELFv1 functions are symbols in `.opd`;
 * objdump labels the code `.<name>`.
 */
export const ps3Gcc: MatchTarget = {
  id: "ps3-gcc",
  images: ["ghcr.io/re-hydra/ps3-gcc:powerpc64"],
  family: ppcFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "big",
  tools: {
    c: { env: "MATCHD_PS3_GCC", fallback: "powerpc64-linux-gnu-gcc" },
    cpp: { env: "MATCHD_PS3_GXX", fallback: "powerpc64-linux-gnu-g++" },
    nm: { env: "MATCHD_PS3_NM", fallback: "powerpc64-linux-gnu-nm" },
    objdump: { env: "MATCHD_PS3_OBJDUMP", fallback: "ps3-objdump" }
  }
}
