import type { CpuFamily } from "../families/types.js"

/** A binary this process runs, overridable with an environment variable. */
export type TargetTool = {
  readonly env: string
  readonly fallback: string
}

/**
 * One installed compiler image.
 * `images` are the toolchain.image strings projects already store.
 * `pin` names how the backend binary is hashed.
 * `objectFormat` names how a symbol and its relocations are read.
 * `tools` are the compiler, nm, and objdump that image actually runs.
 * A console is a new target file, not a new branch in compile.ts.
 */
export type MatchTarget = {
  readonly id: string
  readonly images: ReadonlyArray<string>
  readonly family: CpuFamily
  readonly pin: "gcc-cc1" | "agbcc" | "mwcc" | "clang"
  readonly objectFormat: "elf-objdump" | "coff-objdump"
  /** objdump prints an instruction as an integer. This is how those bytes sit in memory. */
  readonly endian: "little" | "big"
  readonly tools: {
    readonly c: TargetTool
    readonly cpp?: TargetTool
    readonly nm: TargetTool
    readonly objdump: TargetTool
  }
}
