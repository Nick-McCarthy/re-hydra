import { armFamily } from "../families/arm.js"
import type { MatchTarget } from "./types.js"

/**
 * Game Boy Advance titles built with pret's reconstructed `agbcc`.
 * The image is `apps/matchd/Dockerfile.agbcc`. Host gcc does not match these bytes.
 */
export const gbaAgbcc: MatchTarget = {
  id: "gba-agbcc",
  images: ["ghcr.io/re-hydra/agbcc:gba"],
  family: armFamily,
  pin: "agbcc",
  objectFormat: "elf-objdump",
  endian: "little",
  tools: {
    c: { env: "MATCHD_AGBCC", fallback: "agbcc-cc" },
    nm: { env: "MATCHD_ARM_NM", fallback: "arm-none-eabi-nm" },
    objdump: { env: "MATCHD_ARM_OBJDUMP", fallback: "arm-none-eabi-objdump" }
  }
}
