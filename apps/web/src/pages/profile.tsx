import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { FollowButton } from "@/components/follow-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, api, type PublicUserProfile } from "@/lib/api"

export function ProfilePage() {
  const { userId = "" } = useParams()
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
          {profile.regressions} regression{profile.regressions === 1 ? "" : "s"} ·{" "}
          {profile.followerCount} follower{profile.followerCount === 1 ? "" : "s"}
        </p>
      </div>

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
