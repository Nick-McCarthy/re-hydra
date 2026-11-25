import { armFamily } from "../families/arm.js"
import type { MatchTarget } from "./types.js"

/**
 * Nintendo DS, little-endian ARM ELF. The image is Debian `arm-none-eabi-gcc`.
 * One ROM holds an ARM9 and an ARM7. The recipe flags name which CPU a chunk
 * belongs to: `-march=armv5te` for the ARM9, `-march=armv4t -mthumb` for the ARM7.
 * `mwccarm` and `armcc` are different binaries.
 */
export const dsGcc: MatchTarget = {
  id: "ds-gcc",
  images: ["ghcr.io/re-hydra/ds-gcc:arm"],
  family: armFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_DS_GCC", fallback: "arm-none-eabi-gcc" },
    cpp: { env: "MATCHD_DS_GXX", fallback: "arm-none-eabi-g++" },
    nm: { env: "MATCHD_DS_NM", fallback: "arm-none-eabi-nm" },
    objdump: { env: "MATCHD_DS_OBJDUMP", fallback: "arm-none-eabi-objdump" },
    ld: { env: "MATCHD_DS_LD", fallback: "arm-none-eabi-ld" },
    thumbAs: { env: "MATCHD_DS_AS", fallback: "arm-none-eabi-as" }
  }
}
