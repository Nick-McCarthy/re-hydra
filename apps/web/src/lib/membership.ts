import * as React from "react"
import { api, type ProjectMembership } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function useMembership(projectSlug: string) {
  const { session, ready: authReady } = useAuth()
  const [role, setRole] = React.useState<ProjectMembership["role"] | null>(null)
  const [ready, setReady] = React.useState(false)
  // Bumped after a member change (A-011) so the caller's own role is re-read.
  const [version, setVersion] = React.useState(0)
  const reload = React.useCallback(() => setVersion((v) => v + 1), [])

  React.useEffect(() => {
    if (!authReady) {
      console.log(`[project] membership waiting for auth ${projectSlug}`)
      return
    }
    if (!session) {
      console.log(`[project] membership skipped, signed out ${projectSlug}`)
      setRole(null)
      setReady(true)
      return
    }
    let cancelled = false
    setReady(false)
    const started = performance.now()
    console.log(`[project] membership start ${projectSlug}`)
    void api.membership(projectSlug, session.token).then(
      (membership) => {
        if (cancelled) return
        console.log(
          `[project] membership ${Math.round(performance.now() - started)}ms role=${membership.role}`
        )
        setRole(membership.role)
        setReady(true)
      },
      (err) => {
        if (cancelled) return
        console.log(`[project] membership failed ${Math.round(performance.now() - started)}ms`, err)
        setRole(null)
        setReady(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [projectSlug, session, authReady, version])

  return {
    role,
    ready,
    canMaintain: role === "owner" || role === "maintainer",
    reload
  }
}
