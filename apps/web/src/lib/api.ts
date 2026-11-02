export type UserProfile = {
  id: string
  email: string
  displayName: string
}

export type Session = {
  token: string
  expiresAt: string
  user: UserProfile
}

export type Toolchain = {
  compiler: string
  version: string
  flags: Array<string>
  image: string
}

export type ProjectStats = {
  open: number
  leased: number
  validating: number
  matched: number
  stale: number
  blocked: number
  total: number
}

export type SourceLanguage = "c" | "cpp"

export type IntegrationStatus = "queued" | "running" | "passed" | "failed" | "error"

export type IntegrationUnit = {
  chunkId: string
  name: string
  address: string
  size: number
  passed: boolean | null
  detail: string
}

export type Integration = {
  id: string
  projectId: string
  binaryId: string
  status: IntegrationStatus
  language: SourceLanguage
  toolchain: Toolchain
  toolchainDigest: string | null
  summary: string
  diagnostics: string | null
  units: Array<IntegrationUnit>
  createdAt: string
  finishedAt: string | null
}

export type ProjectSummary = {
  id: string
  slug: string
  name: string
  description: string
  homeRegion: string
  language: string
  toolchain: Toolchain
  leaseHours: number
  maxHoldHours: number
  maxConcurrentLeases: number
  followerCount: number
  lastActivityAt: string
  stats: ProjectStats
  createdAt: string
}

export type ChunkState = "open" | "leased" | "validating" | "matched" | "stale" | "blocked"

export type ChunkSummary = {
  id: string
  projectId: string
  binaryId: string
  name: string
  address: string
  size: number
  state: ChunkState
  leaseUserId?: string
  leaseExpiresAt?: string
  holdStartedAt?: string
  languageOverride?: string
  leaseCount: number
}

export type Neighbor = {
  chunkId: string
  name: string
  address: string
  size: number
}

export type WorkBundle = {
  meta: {
    chunkId: string
    projectSlug: string
    name: string
    address: string
    size: number
    arch: string
    language: string
    toolchain: Toolchain
    bytesSha256: string
    typeRevision: number
  }
  originalBytesBase64: string
  pseudocode: string
  disassembly: string
  types: string
  neighbors: Array<Neighbor>
  bestAttemptSource?: string
}

export type LeaseWithBundle = {
  chunk: ChunkSummary
  leaseToken: string
  leaseExpiresAt: string
  holdStartedAt: string
  bundle: WorkBundle
}

export type AttemptResult = {
  attemptId: string
  chunkId: string
  jobId: string
  state: "queued" | "validating" | "finished"
  score: number | null
  matched: boolean | null
  diagnostics: string | null
  leaseToken: string
}

export type AttemptSummary = {
  id: string
  chunkId: string
  userId: string
  displayName: string
  score: number | null
  matched: boolean | null
  compilerOk: boolean | null
  diagnostics: string | null
  best: boolean
  createdAt: string
  finishedAt: string | null
}

export type MatchedChunkRef = {
  matchId: string
  chunkId: string
  projectSlug: string
  projectName: string
  chunkName: string
  address: string
  language: string
  createdAt: string
  active: boolean
}

export type MaintainedProjectRef = {
  slug: string
  name: string
  role: "owner" | "maintainer"
}

export type PublicUserProfile = {
  id: string
  displayName: string
  createdAt: string
  matchedCount: number
  survivingMatches: number
  regressions: number
  reputation: number
  followerCount: number
  followingCount: number
  matchedChunks: Array<MatchedChunkRef>
  projects: Array<MaintainedProjectRef>
}

export type ProjectEvent = {
  id: string
  projectId: string
  projectSlug: string
  projectName: string
  actorId?: string
  actorName?: string
  kind: string
  chunkId?: string
  chunkName?: string
  summary: string
  createdAt: string
}

export type FollowState = {
  following: boolean
}

export type UserSearchHit = {
  id: string
  displayName: string
  reputation: number
  survivingMatches: number
  regressions: number
  createdAt: string
}

export type ProjectMembership = {
  projectSlug: string
  role: "owner" | "maintainer" | "contributor"
}

export type ProposalState =
  | "open"
  | "revalidating"
  | "ready"
  | "accepted"
  | "rejected"
  | "withdrawn"

export type TypeProposal = {
  id: string
  projectId: string
  baseRevisionId: string
  title: string
  description: string
  state: ProposalState
  createdBy: string
  revalidationStartedBy?: string
  reviewedBy?: string
  reviewerCount: number
  resultingRevisionId?: string
  affectedTypes: Array<string>
  headers?: string
  revalidationTotal: number
  revalidationDone: number
  revalidationFailed: number
  createdAt: string
  closedAt?: string
}

export type TypeEnvironment = {
  revision: number
  headers: string
  createdAt: string
  typeNames: Array<string>
}

export type UnresolvedType = {
  id: string
  projectId: string
  typeName: string
  reason: string
  createdBy: string
  createdAt: string
  clearedAt?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed (${status})`)
    this.name = "ApiError"
    this.status = status
    this.body = body
  }
}

const SESSION_KEY = "re-hydra.session"

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Session
  } catch {
    return null
  }
}

export function saveSession(session: Session | null): void {
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } else {
    localStorage.removeItem(SESSION_KEY)
  }
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`)
  }

  const res = await fetch(`/v1${path}`, { ...init, headers })
  const body = await parseBody(res)
  if (!res.ok) {
    throw new ApiError(res.status, body, typeof body === "object" && body && "message" in body
      ? String((body as { message: unknown }).message)
      : undefined)
  }
  return body as T
}

export const api = {
  requestMagicLink(email: string, displayName?: string) {
    return request<{ ok: true; devToken?: string }>("/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({ email, ...(displayName ? { displayName } : {}) })
    })
  },

  consumeMagicLink(token: string) {
    return request<Session>("/auth/magic-link/consume", {
      method: "POST",
      body: JSON.stringify({ token })
    })
  },

  me(token: string) {
    return request<UserProfile>("/auth/me", {}, token)
  },

  logout(token: string) {
    return request<void>("/auth/logout", { method: "POST" }, token)
  },

  listProjects(filters?: { q?: string; language?: string; arch?: string }) {
    const params = new URLSearchParams()
    if (filters?.q) params.set("q", filters.q)
    if (filters?.language) params.set("language", filters.language)
    if (filters?.arch) params.set("arch", filters.arch)
    const qs = params.toString()
    return request<Array<ProjectSummary>>(`/projects${qs ? `?${qs}` : ""}`)
  },

  searchUsers(q: string) {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    const qs = params.toString()
    return request<Array<UserSearchHit>>(`/users${qs ? `?${qs}` : ""}`)
  },

  projectActivity(slug: string) {
    return request<Array<ProjectEvent>>(`/projects/${encodeURIComponent(slug)}/activity`)
  },

  feed(token: string) {
    return request<Array<ProjectEvent>>("/feed", {}, token)
  },

  projectFollowState(slug: string, token: string) {
    return request<FollowState>(`/projects/${encodeURIComponent(slug)}/follow`, {}, token)
  },

  followProject(slug: string, token: string) {
    return request<FollowState>(
      `/projects/${encodeURIComponent(slug)}/follow`,
      { method: "POST" },
      token
    )
  },

  unfollowProject(slug: string, token: string) {
    return request<FollowState>(
      `/projects/${encodeURIComponent(slug)}/follow`,
      { method: "DELETE" },
      token
    )
  },

  userFollowState(userId: string, token: string) {
    return request<FollowState>(`/users/${encodeURIComponent(userId)}/follow`, {}, token)
  },

  followUser(userId: string, token: string) {
    return request<FollowState>(
      `/users/${encodeURIComponent(userId)}/follow`,
      { method: "POST" },
      token
    )
  },

  unfollowUser(userId: string, token: string) {
    return request<FollowState>(
      `/users/${encodeURIComponent(userId)}/follow`,
      { method: "DELETE" },
      token
    )
  },

  updateSettings(
    slug: string,
    body: {
      maxConcurrentLeases?: number
      language?: SourceLanguage
      flags?: Array<string>
    },
    token: string
  ) {
    return request<ProjectSummary>(
      `/projects/${encodeURIComponent(slug)}/settings`,
      { method: "PATCH", body: JSON.stringify(body) },
      token
    )
  },

  listIntegrations(slug: string) {
    return request<Array<Integration>>(`/projects/${encodeURIComponent(slug)}/integrations`)
  },

  startIntegration(
    slug: string,
    body: { binaryId?: string; language?: SourceLanguage },
    token: string
  ) {
    return request<Integration>(
      `/projects/${encodeURIComponent(slug)}/integrations`,
      { method: "POST", body: JSON.stringify(body) },
      token
    )
  },

  setChunkLanguage(
    slug: string,
    chunkId: string,
    language: SourceLanguage | null,
    token: string
  ) {
    return request<ChunkSummary>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/language`,
      { method: "PUT", body: JSON.stringify({ language }) },
      token
    )
  },

  getProject(slug: string) {
    return request<ProjectSummary>(`/projects/${encodeURIComponent(slug)}`)
  },

  membership(slug: string, token: string) {
    return request<ProjectMembership>(
      `/projects/${encodeURIComponent(slug)}/membership`,
      {},
      token
    )
  },

  getUser(userId: string) {
    return request<PublicUserProfile>(`/users/${encodeURIComponent(userId)}`)
  },

  listChunks(slug: string) {
    return request<Array<ChunkSummary>>(`/projects/${encodeURIComponent(slug)}/chunks`)
  },

  getChunk(slug: string, chunkId: string) {
    return request<ChunkSummary>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}`
    )
  },

  getBundle(slug: string, chunkId: string, token: string) {
    return request<WorkBundle>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/bundle`,
      {},
      token
    )
  },

  checkout(slug: string, chunkId: string, token: string) {
    return request<LeaseWithBundle>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/checkout`,
      { method: "POST" },
      token
    )
  },

  release(slug: string, chunkId: string, leaseToken: string, token: string) {
    return request<ChunkSummary>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/release`,
      { method: "POST", body: JSON.stringify({ leaseToken }) },
      token
    )
  },

  heartbeat(slug: string, chunkId: string, leaseToken: string, token: string) {
    return request<{
      chunk: ChunkSummary
      leaseToken: string
      leaseExpiresAt: string
      holdStartedAt: string
    }>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/heartbeat`,
      { method: "POST", body: JSON.stringify({ leaseToken }) },
      token
    )
  },

  submit(slug: string, chunkId: string, leaseToken: string, source: string, token: string) {
    return request<AttemptResult>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/submit`,
      { method: "POST", body: JSON.stringify({ leaseToken, source }) },
      token
    )
  },

  listAttempts(slug: string, chunkId: string) {
    return request<Array<AttemptSummary>>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/attempts`
    )
  },

  clearLease(slug: string, chunkId: string, token: string) {
    return request<ChunkSummary>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/clear`,
      { method: "POST" },
      token
    )
  },

  typeEnvironment(slug: string) {
    return request<TypeEnvironment>(
      `/projects/${encodeURIComponent(slug)}/type-environment`
    )
  },

  listProposals(slug: string) {
    return request<Array<TypeProposal>>(
      `/projects/${encodeURIComponent(slug)}/type-proposals`
    )
  },

  getProposal(slug: string, proposalId: string) {
    return request<TypeProposal>(
      `/projects/${encodeURIComponent(slug)}/type-proposals/${encodeURIComponent(proposalId)}`
    )
  },

  createProposal(
    slug: string,
    body: {
      title: string
      description?: string
      headers: string
      affectedTypes?: Array<string>
    },
    token: string
  ) {
    return request<TypeProposal>(
      `/projects/${encodeURIComponent(slug)}/type-proposals`,
      { method: "POST", body: JSON.stringify(body) },
      token
    )
  },

  startRevalidation(slug: string, proposalId: string, token: string) {
    return request<TypeProposal>(
      `/projects/${encodeURIComponent(slug)}/type-proposals/${encodeURIComponent(proposalId)}/revalidate`,
      { method: "POST" },
      token
    )
  },

  acceptProposal(slug: string, proposalId: string, token: string) {
    return request<TypeProposal>(
      `/projects/${encodeURIComponent(slug)}/type-proposals/${encodeURIComponent(proposalId)}/accept`,
      { method: "POST" },
      token
    )
  },

  listUnresolved(slug: string) {
    return request<Array<UnresolvedType>>(
      `/projects/${encodeURIComponent(slug)}/unresolved-types`
    )
  },

  markUnresolved(
    slug: string,
    body: { typeName: string; reason?: string },
    token: string
  ) {
    return request<UnresolvedType>(
      `/projects/${encodeURIComponent(slug)}/unresolved-types`,
      { method: "POST", body: JSON.stringify(body) },
      token
    )
  },

  clearUnresolved(slug: string, typeName: string, token: string) {
    return request<UnresolvedType>(
      `/projects/${encodeURIComponent(slug)}/unresolved-types/${encodeURIComponent(typeName)}/clear`,
      { method: "POST" },
      token
    )
  },

  fuse(slug: string, chunkIds: Array<string>, name: string | undefined, token: string) {
    return request<ChunkSummary>(
      `/projects/${encodeURIComponent(slug)}/fuse`,
      {
        method: "POST",
        body: JSON.stringify({
          chunkIds,
          ...(name ? { name } : {})
        })
      },
      token
    )
  }
}
