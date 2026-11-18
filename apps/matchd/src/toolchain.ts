import { createHash } from "node:crypto"

/** Digest of the compiler backend, the assembler, and the recipe flags. */
export const toolchainDigest = (
  compilerSha256: string,
  assemblerSha256: string,
  flags: ReadonlyArray<string>,
  language: string
): string => {
  const recipe = createHash("sha256")
    .update(JSON.stringify(flags))
    .update("\n")
    .update(language)
    .digest("hex")
  return `sha256:v2:${compilerSha256}:${assemblerSha256}:${recipe}`
}

const HEX64 = /^[0-9a-f]{64}$/

/**
 * A v2 digest names the binaries. Older digests are a version string and do
 * not pin anything. A malformed v2 digest does not match. The recipe section
 * may differ: a flag change is a new digest, not a different compiler.
 */
export const sameCompiler = (
  expected: string | undefined,
  compilerSha256: string,
  assemblerSha256: string
): boolean => {
  if (expected === undefined || !expected.startsWith("sha256:v2:")) return true
  const parts = expected.split(":")
  if (
    parts.length !== 5 ||
    parts[0] !== "sha256" ||
    parts[1] !== "v2" ||
    !HEX64.test(parts[2] ?? "") ||
    !HEX64.test(parts[3] ?? "") ||
    !HEX64.test(parts[4] ?? "")
  ) {
    return false
  }
  return parts[2] === compilerSha256 && parts[3] === assemblerSha256
}

export type ResolvedToolchain =
  | {
      readonly ok: true
      readonly compilerSha256: string
      readonly assemblerSha256: string
      readonly digest: string
    }
  | { readonly ok: false; readonly reason: string }
