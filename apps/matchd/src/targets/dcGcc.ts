import { shFamily } from "../families/sh.js"
import type { MatchTarget } from "./types.js"

/**
 * Sega Dreamcast SH-4, little-endian ELF.
 * The image is Debian `sh4-linux-gnu-gcc` with `-m4`. That compiler's default
 * is SH-2E, and objdump reports `sh4a` for `-m4`. The Hitachi compiler is a
 * different binary. `dc-objdump` passes `-z` so a zero literal pool is visible.
 * AICA sound code stays out of this target.
 */
export const dcGcc: MatchTarget = {
  id: "dc-gcc",
  images: ["ghcr.io/re-hydra/dc-gcc:sh4"],
  family: shFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_DC_GCC", fallback: "dc-gcc" },
    cpp: { env: "MATCHD_DC_GXX", fallback: "dc-g++" },
    nm: { env: "MATCHD_DC_NM", fallback: "sh4-linux-gnu-nm" },
    objdump: { env: "MATCHD_DC_OBJDUMP", fallback: "dc-objdump" },
    ld: { env: "MATCHD_DC_LD", fallback: "sh4-linux-gnu-ld" }
  }
}
