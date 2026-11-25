import { ppcFamily } from "../families/ppc.js"
import type { MatchTarget } from "./types.js"

/**
 * GameCube and Wii titles built with Metrowerks `mwcceppc`.
 * The image builds the open reimplementation from zcanann/mwcc-rs.
 * A retail CodeWarrior year is selected with that compiler's `--build` flag.
 */
export const gamecubeMwcc: MatchTarget = {
  id: "gamecube-mwcc",
  images: ["ghcr.io/re-hydra/mwcc:gc"],
  family: ppcFamily,
  pin: "mwcc",
  objectFormat: "elf-objdump",
  endian: "big",
  tools: {
    c: { env: "MATCHD_MWCC", fallback: "mwcc-cc" },
    cpp: { env: "MATCHD_MWCC", fallback: "mwcc-cc" },
    nm: { env: "MATCHD_PPC_NM", fallback: "powerpc-linux-gnu-nm" },
    objdump: { env: "MATCHD_PPC_OBJDUMP", fallback: "powerpc-linux-gnu-objdump" },
    ld: { env: "MATCHD_PPC_LD", fallback: "powerpc-linux-gnu-ld" }
  }
}
