import { aarch64Family } from "../families/aarch64.js"
import type { MatchTarget } from "./types.js"

/**
 * Nintendo Switch AArch64 ELF. The image runs Debian Clang with
 * `--target=aarch64-none-elf`. The Nintendo SDK Clang is a different binary
 * and still will not reproduce retail NX bytes.
 */
export const switchClang: MatchTarget = {
  id: "switch-clang",
  images: ["ghcr.io/re-hydra/clang:switch"],
  family: aarch64Family,
  pin: "clang",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_CLANG", fallback: "switch-clang" },
    cpp: { env: "MATCHD_CLANG", fallback: "switch-clang" },
    nm: { env: "MATCHD_LLVM_NM", fallback: "llvm-nm" },
    objdump: { env: "MATCHD_LLVM_OBJDUMP", fallback: "llvm-objdump" }
  }
}
