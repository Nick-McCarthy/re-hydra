import { x86Family } from "../families/x86.js"
import type { MatchTarget } from "./types.js"

/**
 * Modern Microsoft x64 COFF, the object format used by Xbox One and Series.
 * The image runs Clang in the MSVC ABI. Retail Visual C++ is a different
 * binary and still will not reproduce those bytes. Original Xbox reuses these
 * `IMAGE_REL_I386_*` widths with an i386 COFF image.
 */
export const msvcX64: MatchTarget = {
  id: "msvc-x64",
  images: ["ghcr.io/re-hydra/clang:msvc-x64"],
  family: x86Family,
  pin: "clang",
  objectFormat: "coff-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_CLANG", fallback: "coff-clang" },
    cpp: { env: "MATCHD_CLANG", fallback: "coff-clang" },
    nm: { env: "MATCHD_LLVM_NM", fallback: "llvm-nm" },
    objdump: { env: "MATCHD_LLVM_OBJDUMP", fallback: "llvm-objdump" }
  }
}
