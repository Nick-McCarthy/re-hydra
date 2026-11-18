import { x86Family } from "../families/x86.js"
import type { MatchTarget } from "./types.js"

/**
 * PlayStation 4 x86-64 ELF. The image runs Debian Clang with
 * `--target=x86_64-unknown-freebsd`, the public ABI closest to Orbis.
 * The Orbis SDK Clang is a different binary. PS5 reuses this relocation table
 * once a Prospero image exists.
 */
export const ps4Clang: MatchTarget = {
  id: "ps4-clang",
  images: ["ghcr.io/re-hydra/clang:ps4"],
  family: x86Family,
  pin: "clang",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_CLANG", fallback: "ps4-clang" },
    cpp: { env: "MATCHD_CLANG", fallback: "ps4-clang" },
    nm: { env: "MATCHD_LLVM_NM", fallback: "llvm-nm" },
    objdump: { env: "MATCHD_LLVM_OBJDUMP", fallback: "llvm-objdump" }
  }
}
