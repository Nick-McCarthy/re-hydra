import { Navigate } from "react-router-dom"
import { useAuth } from "@/lib/auth"

/** Old /following/users and /following/projects links land on the profile's Following tab. */
export function FollowingRedirect() {
  const { user, ready } = useAuth()
  if (!ready) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={`/users/${user.id}?tab=following`} replace />
}
