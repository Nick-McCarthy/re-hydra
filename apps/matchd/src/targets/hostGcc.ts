import { x86Family } from "../families/x86.js"
import type { MatchTarget } from "./types.js"

/** The gcc/g++ installed in the current matchd image. See apps/matchd/Dockerfile. */
export const hostGcc: MatchTarget = {
  id: "host-gcc",
  images: ["ghcr.io/re-hydra/gcc:host", "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev"],
  family: x86Family,
  pin: "gcc-cc1",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_GCC", fallback: "gcc" },
    cpp: { env: "MATCHD_GXX", fallback: "g++" },
    nm: { env: "MATCHD_NM", fallback: "nm" },
    objdump: { env: "MATCHD_OBJDUMP", fallback: "objdump" }
  }
}
