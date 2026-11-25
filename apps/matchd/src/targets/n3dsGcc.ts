import { armFamily } from "../families/arm.js"
import type { MatchTarget } from "./types.js"

/**
 * Nintendo 3DS ARM11, little-endian ARM ELF.
 * The image is Debian `arm-none-eabi-gcc` with `-march=armv6k -mtune=mpcore`.
 * ARM Compiler 5 (`armcc`) is a different binary. Hard float is a recipe flag:
 * `-mfpu=vfp -mfloat-abi=hard`.
 */
export const n3dsGcc: MatchTarget = {
  id: "3ds-gcc",
  images: ["ghcr.io/re-hydra/3ds-gcc:arm"],
  family: armFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_3DS_GCC", fallback: "3ds-gcc" },
    cpp: { env: "MATCHD_3DS_GXX", fallback: "3ds-g++" },
    nm: { env: "MATCHD_3DS_NM", fallback: "arm-none-eabi-nm" },
    objdump: { env: "MATCHD_3DS_OBJDUMP", fallback: "arm-none-eabi-objdump" },
    ld: { env: "MATCHD_3DS_LD", fallback: "arm-none-eabi-ld" },
    thumbAs: { env: "MATCHD_3DS_AS", fallback: "arm-none-eabi-as" }
  }
}
