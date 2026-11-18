import { ppcFamily } from "../families/ppc.js"
import type { MatchTarget } from "./types.js"

/**
 * Wii U big-endian PowerPC ELF. The image is Debian `powerpc-linux-gnu-gcc`.
 * The Cafe SDK compiler is a different binary and still will not reproduce
 * retail Espresso bytes.
 */
export const wiiuGcc: MatchTarget = {
  id: "wiiu-gcc",
  images: ["ghcr.io/re-hydra/wiiu-gcc:powerpc"],
  family: ppcFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "big",
  tools: {
    c: { env: "MATCHD_WIIU_GCC", fallback: "powerpc-linux-gnu-gcc" },
    cpp: { env: "MATCHD_WIIU_GXX", fallback: "powerpc-linux-gnu-g++" },
    nm: { env: "MATCHD_WIIU_NM", fallback: "powerpc-linux-gnu-nm" },
    objdump: { env: "MATCHD_WIIU_OBJDUMP", fallback: "powerpc-linux-gnu-objdump" }
  }
}
