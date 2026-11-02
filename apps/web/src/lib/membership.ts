import * as React from "react"
import { api, type ProjectMembership } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function useMembership(projectSlug: string) {
  const { session, ready: authReady } = useAuth()
  const [role, setRole] = React.useState<ProjectMembership["role"] | null>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!authReady) return
    if (!session) {
      setRole(null)
      setReady(true)
      return
    }
    let cancelled = false
    setReady(false)
    void api.membership(projectSlug, session.token).then(
      (membership) => {
        if (cancelled) return
        setRole(membership.role)
        setReady(true)
      },
      () => {
        if (cancelled) return
        setRole(null)
        setReady(true)
      }
    )
    return () => {
      cancelled = true
    }
  }, [projectSlug, session, authReady])

  return {
    role,
    ready,
    canMaintain: role === "owner" || role === "maintainer",
    canPropose: role !== null
  }
}
