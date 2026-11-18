import { x86Family } from "../families/x86.js"
import type { MatchTarget } from "./types.js"

/**
 * Original Xbox i386 COFF. The image runs Debian Clang with
 * `--target=i686-pc-windows-msvc`. Visual C++ 6 and 7 are different binaries.
 * `llvm-nm` stores no size, so the function length comes from the disassembly.
 */
export const xboxI386: MatchTarget = {
  id: "xbox-i386",
  images: ["ghcr.io/re-hydra/clang:xbox"],
  family: x86Family,
  pin: "clang",
  objectFormat: "coff-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_CLANG", fallback: "xbox-clang" },
    cpp: { env: "MATCHD_CLANG", fallback: "xbox-clang" },
    nm: { env: "MATCHD_LLVM_NM", fallback: "llvm-nm" },
    objdump: { env: "MATCHD_LLVM_OBJDUMP", fallback: "llvm-objdump" }
  }
}
