import * as React from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, api, type FollowedProject, type UserSearchHit } from "@/lib/api"

/**
 * The people and projects the signed-in user follows, with Unfollow. Shown
 * only on your own profile: the API serves follow lists to their owner only.
 * Replaces the old /following/users and /following/projects pages.
 */
export function ProfileFollowing(props: { readonly token: string; readonly onChanged: () => void }) {
  const { token, onChanged } = props
  const [users, setUsers] = React.useState<ReadonlyArray<UserSearchHit> | null>(null)
  const [projects, setProjects] = React.useState<ReadonlyArray<FollowedProject> | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    Promise.all([api.followingUsers(token), api.followingProjects(token)]).then(
      ([u, p]) => {
        if (cancelled) return
        setUsers(u)
        setProjects(p)
      },
      (err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load who you follow")
      }
    )
    return () => { cancelled = true }
  }, [token])

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure)
    } finally {
      setBusy(false)
    }
  }

  const unfollowUser = (id: string) =>
    run(async () => {
      await api.unfollowUser(id, token)
      setUsers((list) => (list ?? []).filter((u) => u.id !== id))
    }, "Could not unfollow")

  const unfollowProject = (slug: string) =>
    run(async () => {
      await api.unfollowProject(slug, token)
      setProjects((list) => (list ?? []).filter((p) => p.slug !== slug))
    }, "Could not unfollow")

  return (
    <div className="space-y-6">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
          <CardDescription>
            Their activity shows up in your feed. Find more on the{" "}
            <Link to="/people" className="underline underline-offset-2">Users</Link> page.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {users === null ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Loading…</p>
          ) : users.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">You are not following anyone yet.</p>
          ) : (
            <ul className="divide-y border-t text-sm">
              {users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <Link to={`/users/${u.id}`} className="font-medium underline-offset-2 hover:underline">
                    {u.displayName}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">reputation {u.reputation}</span>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void unfollowUser(u.id)}>
                      Unfollow
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            Their board activity shows up in your feed. Find more on the{" "}
            <Link to="/projects" className="underline underline-offset-2">Projects</Link> page.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {projects === null ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">You are not following any projects yet.</p>
          ) : (
            <ul className="divide-y border-t text-sm">
              {projects.map((p) => (
                <li key={p.slug} className="flex items-center justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link to={`/projects/${p.slug}`} className="font-medium underline-offset-2 hover:underline">
                        {p.name}
                      </Link>
                      <Badge variant="secondary">{p.language}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{p.description || p.slug}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void unfollowProject(p.slug)}>
                    Unfollow
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
