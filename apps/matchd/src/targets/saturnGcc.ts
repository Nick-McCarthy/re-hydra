import { shFamily } from "../families/sh.js"
import type { MatchTarget } from "./types.js"

/**
 * Sega Saturn SH-2, little-endian ELF.
 * The image is Debian `sh-elf-gcc`. That compiler's default is SH-1 and
 * big-endian, so the wrapper passes `-m2 -ml`. Objdump then reports `sh2`
 * and `elf32-shl`. The Hitachi compiler is a different binary, and so is
 * the Sega SDK GCC 2.7 compiler. `saturn-objdump` passes `-z` so a zero
 * literal pool is visible. SH-2 has no FPU, so a float add calls `___addsf3`.
 * The SCU DSP stays out of this target. Both SH-2 CPUs share this image.
 */
export const saturnGcc: MatchTarget = {
  id: "saturn-gcc",
  images: ["ghcr.io/re-hydra/saturn-gcc:sh2"],
  family: shFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_SATURN_GCC", fallback: "saturn-gcc" },
    nm: { env: "MATCHD_SATURN_NM", fallback: "sh-elf-nm" },
    objdump: { env: "MATCHD_SATURN_OBJDUMP", fallback: "saturn-objdump" }
  }
}
