/** `sha256:v2:<cc1>:<as>:<recipe>`. Older digests do not name a binary. */
const PINNED = /^sha256:v2:[0-9a-f]{64}:[0-9a-f]{64}:[0-9a-f]{64}$/

export const isPinnedDigest = (digest: string | null | undefined): digest is string =>
  digest != null && PINNED.test(digest)

/** The compiler and assembler hashes inside a v2 digest. */
export const compilerPin = (digest: string): string | undefined => {
  if (!isPinnedDigest(digest)) return undefined
  const parts = digest.split(":")
  return `${parts[2]}:${parts[3]}`
}
