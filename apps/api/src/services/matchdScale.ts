/**
 * Local tags for the images matchd already builds. The scaler starts one of
 * these. It does not accept an image name from a job row unless it is here.
 */
export const localMatchdImage: Readonly<Record<string, string>> = {
  "ghcr.io/re-hydra/gcc:host": "re-hydra-matchd",
  "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev": "re-hydra-matchd",
  "ghcr.io/re-hydra/agbcc:gba": "re-hydra-matchd-gba",
  "ghcr.io/re-hydra/n64-gcc:2.8.1": "re-hydra-matchd-n64",
  "ghcr.io/re-hydra/mwcc:gc": "re-hydra-matchd-mwcc",
  "ghcr.io/re-hydra/clang:msvc-x64": "re-hydra-matchd-coff",
  "ghcr.io/re-hydra/clang:switch": "re-hydra-matchd-switch",
  "ghcr.io/re-hydra/ps1-gcc:mipsel": "re-hydra-matchd-ps1",
  "ghcr.io/re-hydra/ps2-gcc:mips64el": "re-hydra-matchd-ps2",
  "ghcr.io/re-hydra/psp-gcc:allegrex": "re-hydra-matchd-psp",
  "ghcr.io/re-hydra/ps3-gcc:powerpc64": "re-hydra-matchd-ps3",
  "ghcr.io/re-hydra/clang:ps4": "re-hydra-matchd-ps4",
  "ghcr.io/re-hydra/clang:xbox": "re-hydra-matchd-xbox",
  "ghcr.io/re-hydra/wiiu-gcc:powerpc": "re-hydra-matchd-wiiu",
  "ghcr.io/re-hydra/ds-gcc:arm": "re-hydra-matchd-ds",
  "ghcr.io/re-hydra/3ds-gcc:arm": "re-hydra-matchd-3ds",
  "ghcr.io/re-hydra/dc-gcc:sh4": "re-hydra-matchd-dc",
  "ghcr.io/re-hydra/saturn-gcc:sh2": "re-hydra-matchd-saturn",
  "ghcr.io/re-hydra/genesis-gcc:68000": "re-hydra-matchd-genesis"
}

export const interactiveWaitMs = 30_000
export const scaleCooldownMs = 45_000
export const scaleInIdleMs = 60_000
export const defaultScaleMax = 4

export type ScaleDecision = "out" | "in" | "hold"

export const decideScale = (input: {
  readonly waitMs: number
  readonly queued: number
  readonly claimed: number
  readonly urls: number
  readonly warm: number
  readonly maxUrls: number
  readonly pending: boolean
  readonly idleMs: number
}): ScaleDecision => {
  if (
    !input.pending &&
    input.queued > 0 &&
    input.waitMs >= interactiveWaitMs &&
    input.urls < input.maxUrls
  ) {
    return "out"
  }
  if (
    !input.pending &&
    input.queued === 0 &&
    input.claimed === 0 &&
    input.urls > input.warm &&
    input.idleMs >= scaleInIdleMs
  ) {
    return "in"
  }
  return "hold"
}

/** Fewest compiles already sent to that process. Ties keep the earlier URL. */
export const pickUrl = (
  urls: ReadonlyArray<string>,
  inflight: ReadonlyMap<string, number>
): string => {
  let best = urls[0] ?? ""
  let bestCount = inflight.get(best) ?? 0
  for (const url of urls) {
    const count = inflight.get(url) ?? 0
    if (count < bestCount) {
      best = url
      bestCount = count
    }
  }
  return best
}

export const scaleContainerName = (localImage: string, index: number): string => {
  const slug = localImage.replace(/^re-hydra-matchd-?/, "").replace(/[^a-z0-9-]/gi, "") || "host"
  return `rehydra-scale-${slug.slice(0, 40)}-${index}`
}

export const parseDockerPort = (text: string): number | undefined => {
  const match = /:(\d+)\s*$/m.exec(text.trim())
  if (match?.[1] === undefined) return undefined
  const port = Number(match[1])
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return port
}
