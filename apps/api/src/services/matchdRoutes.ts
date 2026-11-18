export type MatchdRoutes = ReadonlyMap<string, ReadonlyArray<string>>

export type ParsedMatchdRoutes =
  | { readonly ok: true; readonly routes: MatchdRoutes }
  | { readonly ok: false; readonly reason: string }

const normalizeUrl = (image: string, raw: string): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly reason: string } => {
  const url = raw.trim().replace(/\/$/, "")
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { ok: false, reason: `url for ${image} must start with http:// or https://` }
  }
  return { ok: true, url }
}

/**
 * `MATCHD_ROUTES` is `image=url` pairs separated by commas.
 * Extra copies of one image are `url|url`. An absent image uses `MATCHD_URL`.
 */
export const parseMatchdRoutes = (raw: string): ParsedMatchdRoutes => {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, routes: new Map() }
  const routes = new Map<string, ReadonlyArray<string>>()
  for (const entry of trimmed.split(",")) {
    const piece = entry.trim()
    if (piece.length === 0) continue
    const eq = piece.indexOf("=")
    if (eq <= 0 || eq === piece.length - 1) {
      return { ok: false, reason: `expected image=url, got "${piece}"` }
    }
    const image = piece.slice(0, eq).trim()
    if (routes.has(image)) {
      return { ok: false, reason: `duplicate route for ${image}` }
    }
    const urls: string[] = []
    for (const part of piece.slice(eq + 1).split("|")) {
      const parsed = normalizeUrl(image, part)
      if (!parsed.ok) return parsed
      if (urls.includes(parsed.url)) {
        return { ok: false, reason: `duplicate url for ${image}` }
      }
      urls.push(parsed.url)
    }
    if (urls.length === 0) {
      return { ok: false, reason: `expected image=url, got "${piece}"` }
    }
    routes.set(image, urls)
  }
  return { ok: true, routes }
}

/** Warm processes for this compiler. Unlisted images stay on the default URL. */
export const matchdUrls = (
  image: string,
  defaultUrl: string,
  routes: MatchdRoutes
): ReadonlyArray<string> => routes.get(image) ?? [defaultUrl.replace(/\/$/, "")]

/** The first warm process for this compiler. */
export const matchdBaseUrl = (
  image: string,
  defaultUrl: string,
  routes: MatchdRoutes
): string => matchdUrls(image, defaultUrl, routes)[0] ?? defaultUrl.replace(/\/$/, "")
