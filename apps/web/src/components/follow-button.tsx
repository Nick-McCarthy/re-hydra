import * as React from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function FollowButton({
  kind,
  id
}: {
  kind: "project" | "user"
  id: string
}) {
  const { session, user } = useAuth()
  const [following, setFollowing] = React.useState<boolean | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const self = kind === "user" && user?.id === id

  React.useEffect(() => {
    if (!session || self) {
      setFollowing(null)
      return
    }
    let cancelled = false
    const load = kind === "project"
      ? api.projectFollowState(id, session.token)
      : api.userFollowState(id, session.token)
    void load.then(
      (state) => {
        if (!cancelled) setFollowing(state.following)
      },
      () => {
        if (!cancelled) setFollowing(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [session, kind, id, self])

  if (self) return null

  if (!session) {
    return (
      <Button asChild variant="outline" size="sm">
        <Link to="/login">Log in to follow</Link>
      </Button>
    )
  }

  async function toggle() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const next = following
        ? kind === "project"
          ? await api.unfollowProject(id, session.token)
          : await api.unfollowUser(id, session.token)
        : kind === "project"
          ? await api.followProject(id, session.token)
          : await api.followUser(id, session.token)
      setFollowing(next.following)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update follow")
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant={following ? "outline" : "default"}
        size="sm"
        disabled={busy || following === null}
        onClick={() => void toggle()}
      >
        {following ? "Following" : "Follow"}
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </span>
  )
}
