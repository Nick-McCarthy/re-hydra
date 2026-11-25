export type UserProfile = {
  id: string
  email: string
  displayName: string
  /** Site admin: sees reports; can archive projects, remove posts, suspend accounts. */
  isAdmin: boolean
}

export type Session = {
  token: string
  expiresAt: string
  user: UserProfile
}

export type AccessTokenSummary = {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

export type AccessTokenCreated = {
  id: string
  label: string
  token: string
  createdAt: string
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
  maxHeldChunks: number
  /** Audit A-012: 'open' or 'members'. */
  checkoutPolicy: "open" | "members"
  followerCount: number
  lastActivityAt: string
  stats: ProjectStats
  createdAt: string
}

export type ImportResult = {
  id: string
  projectId: string
  binaryId: string
  state: "uploaded" | "parsing" | "ready" | "failed"
  functionsTotal: number
  functionsCreated: number
  functionsUpdated: number
  typeRevision: number
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
  /** matchd accepts inline assembly for this chunk. */
  allowInlineAsm: boolean
  /** The current match used inline assembly. */
  matchUsesInlineAsm: boolean
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
  integrationNote?: string
  agentInstructions: string
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
  /** Used inline assembly. Not counted in reputation. */
  usesInlineAsm: boolean
}

export type MaintainedProjectRef = {
  slug: string
  name: string
  role: "owner" | "maintainer"
}

/** Profile phase 1. */
export type WorkLease = {
  projectSlug: string
  projectName: string
  chunkId: string
  chunkName: string
  address: string
  kind: "primary" | "competing"
  leaseToken: string
  leaseExpiresAt: string
  holdStartedAt: string
}

export type WorkAttempt = {
  attemptId: string
  projectSlug: string
  projectName: string
  chunkId: string
  chunkName: string
  createdAt: string
  finishedAt: string | null
  result: "checking" | "matched" | "missed" | "compile_error"
  score: number | null
}

export type MyWork = {
  leases: Array<WorkLease>
  checking: Array<WorkAttempt>
  recent: Array<WorkAttempt>
}

export type UserMatchesPage = {
  items: Array<MatchedChunkRef>
  total: number
}

export type UserProjectRef = {
  slug: string
  name: string
  role: "owner" | "maintainer" | "contributor" | null
  matchCount: number
}

export type MatchesQuery = {
  project?: string
  status?: "active" | "invalidated"
  sort?: "newest" | "oldest"
  limit?: number
  offset?: number
}

export type PublicUserProfile = {
  id: string
  displayName: string
  createdAt: string
  matchedCount: number
  survivingMatches: number
  /** Surviving matches that used inline assembly. Not counted in reputation. */
  assemblyMatches: number
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

export type BlockedUser = {
  userId: string
  displayName: string
  blockedBy: string
  blockedByName: string
  reason: string
  createdAt: string
}

export type UserSearchHit = {
  id: string
  displayName: string
  reputation: number
  survivingMatches: number
  assemblyMatches: number
  regressions: number
  createdAt: string
}

export type FollowedProject = {
  slug: string
  name: string
  description: string
  language: string
}

/** Audit A-011. */
export type ProjectMember = {
  userId: string
  displayName: string
  role: "owner" | "maintainer" | "contributor"
  joinedAt: string
}

export type OwnershipOffer = {
  id: string
  projectSlug: string
  projectName: string
  offeredBy: string
  offeredByName: string
  offeredTo: string
  offeredToName: string
  createdAt: string
  expiresAt: string
}

export type JoinRequest = {
  id: string
  projectSlug: string
  projectName: string
  userId: string
  displayName: string
  message: string
  createdAt: string
}

export type MyJoinRequestState = {
  request: JoinRequest | null
  /** Set for a week after a decline: when the user may ask again. */
  retryAfter: string | null
}

export type MyJoinRequests = {
  waitingOnYou: Array<JoinRequest>
  yours: Array<JoinRequest>
}

export type ThreadSummary = {
  id: string
  title: string
  authorId: string | null
  authorName: string | null
  chunkId: string | null
  chunkName: string | null
  pinned: boolean
  locked: boolean
  replyCount: number
  createdAt: string
  lastPostAt: string
  lastPostBy: string | null
}

export type ThreadPage = {
  items: Array<ThreadSummary>
  total: number
}

export type DiscussionPost = {
  id: string
  authorId: string | null
  authorName: string | null
  body: string
  createdAt: string
  editedAt: string | null
  deleted: boolean
}

export type ThreadDetail = {
  thread: ThreadSummary
  posts: Array<DiscussionPost>
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
  revalidationUnchecked: number
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

function messageFromBody(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined
  const record = body as { message?: unknown; detail?: unknown }
  if (typeof record.detail === "string" && record.detail.trim().length > 0) return record.detail
  if (typeof record.message === "string" && record.message.trim().length > 0) return record.message
  return undefined
}

async function parseBody(res: Response): Promise<{ value: unknown; chars: number }> {
  if (res.status === 204) return { value: undefined, chars: 0 }
  const text = await res.text()
  if (!text) return { value: undefined, chars: 0 }
  try {
    return { value: JSON.parse(text) as unknown, chars: text.length }
  } catch {
    return { value: text, chars: text.length }
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

  const method = init.method ?? "GET"
  const started = performance.now()
  console.log(`[api] -> ${method} ${path}`)
  const res = await fetch(`/v1${path}`, { ...init, headers })
  const fetched = performance.now()
  const parsed = await parseBody(res)
  const done = performance.now()
  console.log(
    `[api] <- ${res.status} ${method} ${path} fetch=${Math.round(fetched - started)}ms body=${Math.round(done - fetched)}ms chars=${parsed.chars}`
  )
  if (!res.ok) {
    throw new ApiError(res.status, parsed.value, messageFromBody(parsed.value))
  }
  return parsed.value as T
}

export type ReportReason = "copyright" | "malware" | "abuse" | "other"

export type ReportTarget = {
  projectSlug: string
  chunkId?: string
  postId?: string
}

type PersonRef = { id: string; displayName: string }

export type AdminReport = {
  id: string
  reason: ReportReason
  body: string
  createdAt: string
  reporter: PersonRef | null
  project: { id: string; slug: string; name: string; archived: boolean }
  chunk: { id: string; name: string } | null
  post: { id: string; threadId: string; excerpt: string; removed: boolean; author: PersonRef | null } | null
  resolvedAt: string | null
  resolution: string | null
  resolvedBy: PersonRef | null
}

export type AdminUser = {
  id: string
  email: string
  displayName: string
  isAdmin: boolean
  suspendedAt: string | null
  suspendedReason: string | null
  createdAt: string
}

export type AdminProject = {
  id: string
  slug: string
  name: string
  ownerName: string | null
  archivedAt: string | null
  openReports: number
  createdAt: string
}

export type ModerationActionKind =
  | "archive_project"
  | "restore_project"
  | "remove_post"
  | "suspend_user"
  | "restore_user"
  | "resolve_report"
  | "grant_admin"
  | "revoke_admin"

export type ModerationAction = {
  id: string
  kind: ModerationActionKind
  admin: PersonRef | null
  project: { id: string; slug: string; name: string } | null
  user: PersonRef | null
  postId: string | null
  reportId: string | null
  note: string
  createdAt: string
}

export const api = {
  signUp(email: string, displayName: string, password: string, acceptPolicy: boolean) {
    return request<Session>("/auth/sign-up", {
      method: "POST",
      body: JSON.stringify({ email, displayName, password, acceptPolicy })
    })
  },

  signIn(email: string, password: string) {
    return request<Session>("/auth/sign-in", {
      method: "POST",
      body: JSON.stringify({ email, password })
    })
  },

  requestPasswordReset(email: string) {
    return request<void>("/auth/password-reset", {
      method: "POST",
      body: JSON.stringify({ email })
    })
  },

  confirmPasswordReset(token: string, newPassword: string) {
    return request<void>("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword })
    })
  },

  changePassword(token: string, currentPassword: string, newPassword: string) {
    return request<Session>("/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword })
    }, token)
  },

  me(token: string) {
    return request<UserProfile>("/auth/me", {}, token)
  },

  logout(token: string) {
    return request<void>("/auth/logout", { method: "POST" }, token)
  },

  listTokens(token: string) {
    return request<Array<AccessTokenSummary>>("/auth/tokens", {}, token)
  },

  createToken(token: string, label: string) {
    return request<AccessTokenCreated>(
      "/auth/tokens",
      { method: "POST", body: JSON.stringify({ label }) },
      token
    )
  },

  revokeToken(token: string, tokenId: string) {
    return request<void>(
      `/auth/tokens/${encodeURIComponent(tokenId)}`,
      { method: "DELETE" },
      token
    )
  },

  createProject(
    token: string,
    body: {
      slug: string
      name: string
      description?: string
      homeRegion: string
      language: SourceLanguage
      toolchain: Toolchain
    }
  ) {
    return request<ProjectSummary>("/projects", {
      method: "POST",
      body: JSON.stringify(body)
    }, token)
  },

  /** Only call once the user has ticked the rights statement on the import form. */
  importExport(slug: string, jsonText: string, token: string) {
    return request<ImportResult>(
      `/projects/${encodeURIComponent(slug)}/imports?rightsConfirmed=true`,
      {
        method: "POST",
        body: jsonText,
        headers: { "content-type": "application/json" }
      },
      token
    )
  },

  listProjects(filters?: { q?: string; language?: string; arch?: string }) {
    const params = new URLSearchParams()
    if (filters?.q) params.set("q", filters.q)
    if (filters?.language) params.set("language", filters.language)
    if (filters?.arch) params.set("arch", filters.arch)
    const qs = params.toString()
    return request<Array<ProjectSummary>>(`/projects${qs ? `?${qs}` : ""}`)
  },

  listBlocks(slug: string, token: string) {
    return request<Array<BlockedUser>>(`/projects/${encodeURIComponent(slug)}/blocks`, {}, token)
  },

  myJoinRequest(slug: string, token: string) {
    return request<MyJoinRequestState>(`/projects/${encodeURIComponent(slug)}/join-request`, {}, token)
  },

  requestToJoin(slug: string, message: string, token: string) {
    return request<MyJoinRequestState>(
      `/projects/${encodeURIComponent(slug)}/join-request`,
      { method: "POST", body: JSON.stringify(message ? { message } : {}) },
      token
    )
  },

  cancelJoinRequest(slug: string, token: string) {
    return request<MyJoinRequestState>(`/projects/${encodeURIComponent(slug)}/join-request`, { method: "DELETE" }, token)
  },

  listJoinRequests(slug: string, token: string) {
    return request<Array<JoinRequest>>(`/projects/${encodeURIComponent(slug)}/join-requests`, {}, token)
  },

  approveJoinRequest(slug: string, requestId: string, token: string) {
    return request<Array<JoinRequest>>(
      `/projects/${encodeURIComponent(slug)}/join-requests/${encodeURIComponent(requestId)}/approve`,
      { method: "POST" },
      token
    )
  },

  declineJoinRequest(slug: string, requestId: string, token: string) {
    return request<Array<JoinRequest>>(
      `/projects/${encodeURIComponent(slug)}/join-requests/${encodeURIComponent(requestId)}/decline`,
      { method: "POST" },
      token
    )
  },

  myJoinRequests(token: string) {
    return request<MyJoinRequests>("/me/join-requests", {}, token)
  },

  listThreads(slug: string, options: { chunkId?: string | null; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams()
    if (options.chunkId) params.set("chunkId", options.chunkId)
    if (options.limit !== undefined) params.set("limit", String(options.limit))
    if (options.offset) params.set("offset", String(options.offset))
    const query = params.toString()
    return request<ThreadPage>(`/projects/${encodeURIComponent(slug)}/threads${query ? `?${query}` : ""}`)
  },

  getThread(slug: string, threadId: string) {
    return request<ThreadDetail>(`/projects/${encodeURIComponent(slug)}/threads/${encodeURIComponent(threadId)}`)
  },

  createThread(slug: string, payload: { title: string; body: string; chunkId?: string }, token: string) {
    return request<ThreadDetail>(
      `/projects/${encodeURIComponent(slug)}/threads`,
      { method: "POST", body: JSON.stringify(payload) },
      token
    )
  },

  updateThread(slug: string, threadId: string, payload: { title?: string; pinned?: boolean; locked?: boolean }, token: string) {
    return request<ThreadDetail>(
      `/projects/${encodeURIComponent(slug)}/threads/${encodeURIComponent(threadId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      token
    )
  },

  deleteThread(slug: string, threadId: string, token: string) {
    return request<void>(
      `/projects/${encodeURIComponent(slug)}/threads/${encodeURIComponent(threadId)}`,
      { method: "DELETE" },
      token
    )
  },

  replyToThread(slug: string, threadId: string, body: string, token: string) {
    return request<ThreadDetail>(
      `/projects/${encodeURIComponent(slug)}/threads/${encodeURIComponent(threadId)}/posts`,
      { method: "POST", body: JSON.stringify({ body }) },
      token
    )
  },

  editPost(slug: string, threadId: string, postId: string, body: string, token: string) {
    return request<ThreadDetail>(
      `/projects/${encodeURIComponent(slug)}/threads/${encodeURIComponent(threadId)}/posts/${encodeURIComponent(postId)}`,
      { method: "PATCH", body: JSON.stringify({ body }) },
      token
    )
  },

  deletePost(slug: string, threadId: string, postId: string, token: string) {
    return request<ThreadDetail>(
      `/projects/${encodeURIComponent(slug)}/threads/${encodeURIComponent(threadId)}/posts/${encodeURIComponent(postId)}`,
      { method: "DELETE" },
      token
    )
  },

  listMembers(slug: string) {
    return request<Array<ProjectMember>>(`/projects/${encodeURIComponent(slug)}/members`)
  },

  addMember(slug: string, userId: string, role: "maintainer" | "contributor", token: string) {
    return request<Array<ProjectMember>>(
      `/projects/${encodeURIComponent(slug)}/members`,
      { method: "POST", body: JSON.stringify({ userId, role }) },
      token
    )
  },

  changeMemberRole(slug: string, userId: string, role: "maintainer" | "contributor", token: string) {
    return request<Array<ProjectMember>>(
      `/projects/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
      token
    )
  },

  removeMember(slug: string, userId: string, token: string) {
    return request<Array<ProjectMember>>(
      `/projects/${encodeURIComponent(slug)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
      token
    )
  },

  ownershipOffer(slug: string, token: string) {
    return request<{ offer: OwnershipOffer | null }>(`/projects/${encodeURIComponent(slug)}/ownership-transfer`, {}, token)
  },

  offerOwnership(slug: string, userId: string, token: string) {
    return request<{ offer: OwnershipOffer | null }>(
      `/projects/${encodeURIComponent(slug)}/ownership-transfer`,
      { method: "POST", body: JSON.stringify({ userId }) },
      token
    )
  },

  acceptOwnership(slug: string, token: string) {
    return request<Array<ProjectMember>>(`/projects/${encodeURIComponent(slug)}/ownership-transfer/accept`, { method: "POST" }, token)
  },

  withdrawOwnership(slug: string, token: string) {
    return request<{ offer: OwnershipOffer | null }>(`/projects/${encodeURIComponent(slug)}/ownership-transfer`, { method: "DELETE" }, token)
  },

  myOwnershipOffers(token: string) {
    return request<Array<OwnershipOffer>>("/ownership-offers", {}, token)
  },

  blockUser(slug: string, userId: string, reason: string, token: string) {
    return request<Array<BlockedUser>>(
      `/projects/${encodeURIComponent(slug)}/blocks`,
      { method: "POST", body: JSON.stringify(reason ? { userId, reason } : { userId }) },
      token
    )
  },

  unblockUser(slug: string, userId: string, token: string) {
    return request<Array<BlockedUser>>(
      `/projects/${encodeURIComponent(slug)}/blocks/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
      token
    )
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

  followingUsers(token: string) {
    return request<Array<UserSearchHit>>("/following/users", {}, token)
  },

  followingProjects(token: string) {
    return request<Array<FollowedProject>>("/following/projects", {}, token)
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
      maxHeldChunks?: number
      language?: SourceLanguage
      flags?: Array<string>
      checkoutPolicy?: "open" | "members"
    },
    token: string
  ) {
    return request<ProjectSummary>(
      `/projects/${encodeURIComponent(slug)}/settings`,
      { method: "PATCH", body: JSON.stringify(body) },
      token
    )
  },

  /** Signed in as an owner or maintainer, link mismatches include the bytes. */
  listIntegrations(slug: string, token?: string | null) {
    return request<Array<Integration>>(
      `/projects/${encodeURIComponent(slug)}/integrations`,
      {},
      token
    )
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

  setChunkInlineAsm(slug: string, chunkId: string, allow: boolean, token: string) {
    return request<ChunkSummary>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/inline-asm`,
      { method: "PUT", body: JSON.stringify({ allow }) },
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

  userMatches(userId: string, query: MatchesQuery) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value))
    }
    const qs = params.toString()
    return request<UserMatchesPage>(`/users/${encodeURIComponent(userId)}/matches${qs ? `?${qs}` : ""}`)
  },

  userProjects(userId: string) {
    return request<Array<UserProjectRef>>(`/users/${encodeURIComponent(userId)}/projects`)
  },

  myWork(token: string) {
    return request<MyWork>("/me/work", {}, token)
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

  /**
   * Byte comparisons in diagnostics come back only on the caller's own attempts,
   * or on all of them for the chunk's holder and project maintainers.
   */
  listAttempts(slug: string, chunkId: string, token?: string | null) {
    return request<Array<AttemptSummary>>(
      `/projects/${encodeURIComponent(slug)}/chunks/${encodeURIComponent(chunkId)}/attempts`,
      {},
      token
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
  },

  report(target: ReportTarget, reason: ReportReason, body: string, token: string) {
    return request<{ id: string }>(
      "/reports",
      { method: "POST", body: JSON.stringify({ ...target, reason, body }) },
      token
    )
  },

  adminReports(status: "open" | "resolved", token: string) {
    return request<Array<AdminReport>>(`/admin/reports?status=${status}`, {}, token)
  },

  adminResolveReport(reportId: string, resolution: string, token: string) {
    return request<AdminReport>(
      `/admin/reports/${encodeURIComponent(reportId)}/resolve`,
      { method: "POST", body: JSON.stringify({ resolution }) },
      token
    )
  },

  adminProjects(q: string, token: string) {
    return request<Array<AdminProject>>(`/admin/projects?q=${encodeURIComponent(q)}`, {}, token)
  },

  adminSetProjectArchived(slug: string, archived: boolean, note: string, token: string) {
    return request<AdminProject>(
      `/admin/projects/${encodeURIComponent(slug)}/${archived ? "archive" : "restore"}`,
      { method: "POST", body: JSON.stringify({ note }) },
      token
    )
  },

  adminRemovePost(postId: string, note: string, token: string) {
    return request<void>(
      `/admin/posts/${encodeURIComponent(postId)}/remove`,
      { method: "POST", body: JSON.stringify({ note }) },
      token
    )
  },

  adminUsers(q: string, token: string) {
    return request<Array<AdminUser>>(`/admin/users?q=${encodeURIComponent(q)}`, {}, token)
  },

  adminSetUserSuspended(userId: string, suspended: boolean, note: string, token: string) {
    return request<AdminUser>(
      `/admin/users/${encodeURIComponent(userId)}/${suspended ? "suspend" : "restore"}`,
      { method: "POST", body: JSON.stringify({ note }) },
      token
    )
  },

  adminActions(token: string) {
    return request<Array<ModerationAction>>("/admin/actions?limit=200", {}, token)
  }
}
