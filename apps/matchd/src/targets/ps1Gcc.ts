import { mipsFamily } from "../families/mips.js"
import type { MatchTarget } from "./types.js"

/**
 * PlayStation little-endian MIPS ELF. The image is Debian `mipsel-linux-gnu-gcc`.
 * PSY-Q `ccpsx` is a different binary, and its objects are often not ELF.
 */
export const ps1Gcc: MatchTarget = {
  id: "ps1-gcc",
  images: ["ghcr.io/re-hydra/ps1-gcc:mipsel"],
  family: mipsFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_PS1_GCC", fallback: "mipsel-linux-gnu-gcc" },
    cpp: { env: "MATCHD_PS1_GXX", fallback: "mipsel-linux-gnu-g++" },
    nm: { env: "MATCHD_MIPSEL_NM", fallback: "mipsel-linux-gnu-nm" },
    objdump: { env: "MATCHD_MIPSEL_OBJDUMP", fallback: "mipsel-linux-gnu-objdump" },
    ld: { env: "MATCHD_MIPSEL_LD", fallback: "mipsel-linux-gnu-ld" }
  }
}
