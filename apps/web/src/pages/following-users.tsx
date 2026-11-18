import * as React from "react"
import { Link, Navigate } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { ApiError, api, type UserSearchHit } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function FollowingUsersPage() {
  const { session, ready } = useAuth()
  const [hits, setHits] = React.useState<Array<UserSearchHit> | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!session) return
    let cancelled = false
    void (async () => {
      try {
        const list = await api.followingUsers(session.token)
        if (!cancelled) setHits(list)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load users")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session])

  if (!ready) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users you follow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          People whose activity shows up in your feed.
        </p>
      </div>
      {hits === null ? (
        <p className="text-sm text-muted-foreground">Loading users…</p>
      ) : hits.length === 0 ? (
        <p className="text-sm text-muted-foreground">You are not following anyone yet.</p>
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-6">
            {hits.map((hit) => (
              <div key={hit.id} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  to={`/users/${hit.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {hit.displayName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  reputation {hit.reputation}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
