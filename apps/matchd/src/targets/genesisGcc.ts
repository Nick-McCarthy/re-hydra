import { m68kFamily } from "../families/m68k.js"
import type { MatchTarget } from "./types.js"

/**
 * Sega Genesis / Mega Drive 68000, big-endian ELF.
 * The image is Debian `m68k-linux-gnu-gcc` with `-m68000`. That compiler's
 * default `-mcpu` is 68020, and objdump then reports a generic `m68k`.
 * With `-m68000` it reports `m68k:68000`. The SN Systems compiler, Sierra C,
 * and the Sega SDK C compiler are different binaries. Most Genesis games are
 * assembly. The Z80 sound CPU stays out of this target.
 */
export const genesisGcc: MatchTarget = {
  id: "genesis-gcc",
  images: ["ghcr.io/re-hydra/genesis-gcc:68000"],
  family: m68kFamily,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "big",
  tools: {
    c: { env: "MATCHD_GENESIS_GCC", fallback: "genesis-gcc" },
    cpp: { env: "MATCHD_GENESIS_GXX", fallback: "genesis-g++" },
    nm: { env: "MATCHD_GENESIS_NM", fallback: "m68k-linux-gnu-nm" },
    objdump: { env: "MATCHD_GENESIS_OBJDUMP", fallback: "m68k-linux-gnu-objdump" },
    ld: { env: "MATCHD_GENESIS_LD", fallback: "m68k-linux-gnu-ld" }
  }
}
