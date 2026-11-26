import * as React from "react"
import { Link, useParams, useSearchParams } from "react-router-dom"
import { FollowButton } from "@/components/follow-button"
import { OwnershipOffersBanner } from "@/components/ownership-offers-banner"
import { ProfileFollowing } from "@/components/profile-following"
import { MatchesTable, ProfileMatches } from "@/components/profile-matches"
import { ProfileWork } from "@/components/profile-work"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ApiError,
  api,
  type AccessTokenCreated,
  type AccessTokenSummary,
  type TokenScope,
  type PublicUserProfile,
  type UserProjectRef
} from "@/lib/api"
import { useAuth } from "@/lib/auth"

type Tab = "work" | "overview" | "matches" | "projects" | "following"

const tabLabels: Record<Tab, string> = {
  work: "My work",
  overview: "Overview",
  matches: "Matches",
  projects: "Projects",
  following: "Following"
}

export function ProfilePage() {
  const { userId = "" } = useParams()
  const { user, session } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [profile, setProfile] = React.useState<PublicUserProfile | null>(null)
  const [projects, setProjects] = React.useState<ReadonlyArray<UserProjectRef> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [version, setVersion] = React.useState(0)

  const isSelf = session !== null && user?.id === userId
  const tabs: ReadonlyArray<Tab> = isSelf
    ? ["work", "overview", "matches", "projects", "following"]
    : ["overview", "matches", "projects"]
  const requested = searchParams.get("tab")
  // Your own profile opens on My work; everyone else's on the overview.
  const tab: Tab = tabs.find((t) => t === requested) ?? tabs[0]!

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [p, projectList] = await Promise.all([api.getUser(userId), api.userProjects(userId)])
        if (cancelled) return
        setProfile(p)
        setProjects(projectList)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load profile")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId, version])

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!profile || !projects) {
    return <p className="text-sm text-muted-foreground">Loading profile…</p>
  }

  const selectTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams)
    params.set("tab", next)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{profile.displayName}</h1>
          <FollowButton kind="user" id={profile.id} />
        </div>
        <p className="text-sm text-muted-foreground">
          Joined {new Date(profile.createdAt).toLocaleDateString()} · reputation {profile.reputation}{" "}
          · {profile.survivingMatches} surviving match{profile.survivingMatches === 1 ? "" : "es"} ·{" "}
          {profile.assemblyMatches > 0 ? (
            <span title="Matches that used inline assembly. They are shown but do not count toward reputation.">
              {profile.assemblyMatches} assembly match{profile.assemblyMatches === 1 ? "" : "es"} (not counted) ·{" "}
            </span>
          ) : null}
          {profile.regressions} regression{profile.regressions === 1 ? "" : "s"} ·{" "}
          {profile.followerCount} follower{profile.followerCount === 1 ? "" : "s"}
        </p>
      </div>

      {isSelf && session ? (
        <OwnershipOffersBanner token={session.token} onChanged={() => setVersion((v) => v + 1)} />
      ) : null}

      <nav className="flex flex-wrap gap-1 border-b" aria-label="Profile sections">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => selectTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === t
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tabLabels[t]}
          </button>
        ))}
      </nav>

      {tab === "work" && session ? <ProfileWork token={session.token} /> : null}

      {tab === "following" && session ? (
        // Unfollowing changes the following count in the header.
        <ProfileFollowing token={session.token} onChanged={() => setVersion((v) => v + 1)} />
      ) : null}

      {tab === "overview" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Recent matches</CardTitle>
              <CardDescription>
                The latest five.{" "}
                <button type="button" className="underline underline-offset-2" onClick={() => selectTab("matches")}>
                  See all
                </button>
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {profile.matchedChunks.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">No matches yet.</p>
              ) : (
                <MatchesTable items={profile.matchedChunks.slice(0, 5)} />
              )}
            </CardContent>
          </Card>
          {projects.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Projects</CardTitle>
                <CardDescription>
                  {projects.length > 5 ? (
                    <>
                      Top five.{" "}
                      <button type="button" className="underline underline-offset-2" onClick={() => selectTab("projects")}>
                        See all {projects.length}
                      </button>
                    </>
                  ) : (
                    "Memberships and projects with matches."
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ProjectsTable projects={projects.slice(0, 5)} />
              </CardContent>
            </Card>
          ) : null}
          {isSelf && session ? <AccessTokensCard token={session.token} /> : null}
        </>
      ) : null}

      {tab === "matches" ? <ProfileMatches userId={profile.id} projects={projects} /> : null}

      {tab === "projects" ? (
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>
              Projects this user belongs to, and projects where they have surviving matches.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {projects.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              <ProjectsTable projects={projects} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function ProjectsTable(props: { readonly projects: ReadonlyArray<UserProjectRef> }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
        <tr>
          <th className="px-4 py-2 font-medium">Project</th>
          <th className="px-4 py-2 font-medium">Role</th>
          <th className="px-4 py-2 text-right font-medium">Matches</th>
        </tr>
      </thead>
      <tbody>
        {props.projects.map((p) => (
          <tr key={p.slug} className="border-b last:border-0">
            <td className="px-4 py-2">
              <Link to={`/projects/${p.slug}`} className="font-medium underline-offset-2 hover:underline">
                {p.name}
              </Link>
            </td>
            <td className="px-4 py-2">
              {p.role ? (
                <Badge variant={p.role === "contributor" ? "outline" : "secondary"}>{p.role}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">not a member</span>
              )}
            </td>
            <td className="px-4 py-2 text-right font-mono text-xs">{p.matchCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AccessTokensCard({ token }: { token: string }) {
  const [tokens, setTokens] = React.useState<Array<AccessTokenSummary>>([])
  const [label, setLabel] = React.useState("")
  const [scope, setScope] = React.useState<TokenScope>("work")
  const [secret, setSecret] = React.useState<AccessTokenCreated | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    const rows = await api.listTokens(token)
    setTokens(rows)
  }, [token])

  React.useEffect(() => {
    let cancelled = false
    void api.listTokens(token).then(
      (rows) => {
        if (!cancelled) setTokens(rows)
      },
      (err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load tokens")
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [token])

  async function createToken(event: React.FormEvent) {
    event.preventDefault()
    const name = label.trim()
    if (name.length === 0) {
      setError("Enter a name for this token.")
      setStatus(null)
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const created = await api.createToken(token, name, scope)
      setSecret(created)
      setLabel("")
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the token")
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await api.revokeToken(token, id)
      if (secret?.id === id) setSecret(null)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the token")
    } finally {
      setBusy(false)
    }
  }

  async function copySecret() {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret.token)
      setStatus("Copied.")
    } catch {
      setStatus("Select the token and copy it.")
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>CLI tokens</CardTitle>
        <CardDescription>
          A token lets hydra, or an agent using it, act as you. Copy it once. It stays valid after a password
          change until you revoke it. Give agents a work token: it can check out, submit, heartbeat, release, and
          propose types, but cannot start builds, import, change projects or members, or manage your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={createToken}>
          <div className="space-y-2">
            <Label htmlFor="token-label">Name</Label>
            <Input
              id="token-label"
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="laptop"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="token-scope">Access</Label>
            <select
              id="token-scope"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={scope}
              onChange={(event) => setScope(event.target.value === "all" ? "all" : "work")}
            >
              <option value="work">Work: contributor work only</option>
              <option value="all">Full: anything your account can do</option>
            </select>
          </div>
          <Button type="submit" disabled={busy}>
            Create token
          </Button>
        </form>

        {secret ? (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <p className="text-sm">Copy this token now. It will not be shown again.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={secret.token} className="font-mono text-xs" />
              <Button type="button" variant="secondary" onClick={() => void copySecret()}>
                Copy
              </Button>
            </div>
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}

        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {tokens.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    {row.label}
                    <Badge variant={row.scope === "work" ? "outline" : "secondary"}>
                      {row.scope === "work" ? "work" : "full access"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(row.createdAt).toLocaleString()}
                    {row.lastUsedAt
                      ? ` · last used ${new Date(row.lastUsedAt).toLocaleString()}`
                      : " · not used yet"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void revoke(row.id)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
