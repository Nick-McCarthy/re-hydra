import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { FollowButton } from "@/components/follow-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, type AccessTokenCreated, type AccessTokenSummary, type PublicUserProfile } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function ProfilePage() {
  const { userId = "" } = useParams()
  const { user, session } = useAuth()
  const [profile, setProfile] = React.useState<PublicUserProfile | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const p = await api.getUser(userId)
        if (!cancelled) setProfile(p)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load profile")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!profile) {
    return <p className="text-sm text-muted-foreground">Loading profile…</p>
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

      {session && user?.id === profile.id ? <AccessTokensCard token={session.token} /> : null}

      {profile.projects.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Maintains</CardTitle>
            <CardDescription>Projects where this user is owner or maintainer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {profile.projects.map((p) => (
              <div key={p.slug} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  to={`/projects/${p.slug}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {p.name}
                </Link>
                <Badge variant="secondary">{p.role}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Matched chunks</CardTitle>
          <CardDescription>Most recent matches first.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {profile.matchedChunks.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No matches yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Chunk</th>
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {profile.matchedChunks.map((m) => (
                  <tr key={m.matchId} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        to={`/projects/${m.projectSlug}/chunks/${m.chunkId}`}
                        className="font-mono text-xs underline-offset-2 hover:underline"
                      >
                        {m.chunkName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to={`/projects/${m.projectSlug}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {m.projectName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      {m.usesInlineAsm ? (
                        <Badge variant="outline" className="mr-1" title="Used inline assembly. Not counted toward reputation.">
                          asm
                        </Badge>
                      ) : null}
                      <Badge variant={m.active ? "success" : "outline"}>
                        {m.active ? "active" : "invalidated"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AccessTokensCard({ token }: { token: string }) {
  const [tokens, setTokens] = React.useState<Array<AccessTokenSummary>>([])
  const [label, setLabel] = React.useState("")
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
      const created = await api.createToken(token, name)
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
          A token lets hydra act as you. Copy it once. It stays valid after a password change until you revoke it.
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
                  <p className="font-medium">{row.label}</p>
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
