import { mipsFamily } from "../families/mips.js"
import type { MatchTarget } from "./types.js"

/**
 * Nintendo 64 games built with GNU GCC 2.8.1, big-endian MIPS.
 * The image is `apps/matchd/Dockerfile.n64`. IDO and the Nintendo SDK GCC are
 * other images; they reuse this family once those compilers are installed.
 */
export const n64Gcc: MatchTarget = {
  id: "n64-gcc",
  images: ["ghcr.io/re-hydra/n64-gcc:2.8.1"],
  family: mipsFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "big",
  tools: {
    c: { env: "MATCHD_N64_GCC", fallback: "mips-linux-gnu-gcc" },
    nm: { env: "MATCHD_MIPS_NM", fallback: "mips-linux-gnu-nm" },
    objdump: { env: "MATCHD_MIPS_OBJDUMP", fallback: "mips-linux-gnu-objdump" }
  }
}
