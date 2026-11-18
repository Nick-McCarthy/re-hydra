import * as React from "react"
import { Link, Navigate } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, api, type FollowedProject } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function FollowingProjectsPage() {
  const { session, ready } = useAuth()
  const [projects, setProjects] = React.useState<Array<FollowedProject> | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!session) return
    let cancelled = false
    void (async () => {
      try {
        const list = await api.followingProjects(session.token)
        if (!cancelled) setProjects(list)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load projects")
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
        <h1 className="text-2xl font-semibold tracking-tight">Projects you follow</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Boards whose activity shows up in your feed.
        </p>
      </div>
      {projects === null ? (
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">You are not following any projects yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.slug} to={`/projects/${project.slug}`} className="block">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{project.name}</CardTitle>
                    <Badge variant="secondary">{project.language}</Badge>
                  </div>
                  <CardDescription className="font-mono text-xs">{project.slug}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {project.description || "No description"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
