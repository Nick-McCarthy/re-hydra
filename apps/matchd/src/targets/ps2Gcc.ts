import { mipsFamily } from "../families/mips.js"
import type { MatchTarget } from "./types.js"

/**
 * PlayStation 2 Emotion Engine, little-endian MIPS ELF.
 * The image is Debian `mips64el-linux-gnuabi64-gcc` with `-march=r5900`
 * and `-msingle-float`. Sony `ee-gcc` is a different binary. VU microcode
 * is a second processor and stays out of this target.
 */
export const ps2Gcc: MatchTarget = {
  id: "ps2-gcc",
  images: ["ghcr.io/re-hydra/ps2-gcc:mips64el"],
  family: mipsFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_PS2_GCC", fallback: "ps2-gcc" },
    cpp: { env: "MATCHD_PS2_GXX", fallback: "ps2-g++" },
    nm: { env: "MATCHD_PS2_NM", fallback: "mips64el-linux-gnuabi64-nm" },
    objdump: { env: "MATCHD_PS2_OBJDUMP", fallback: "mips64el-linux-gnuabi64-objdump" },
    ld: { env: "MATCHD_PS2_LD", fallback: "mips64el-linux-gnuabi64-ld" }
  }
}
