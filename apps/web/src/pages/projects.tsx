import * as React from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ApiError, api, type ProjectSummary } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function ProjectsPage() {
  const { user } = useAuth()
  const [projects, setProjects] = React.useState<Array<ProjectSummary> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState("")
  const [language, setLanguage] = React.useState("")
  const [arch, setArch] = React.useState("")

  React.useEffect(() => {
    let cancelled = false
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const list = await api.listProjects({
            q: q.trim() || undefined,
            language: language.trim() || undefined,
            arch: arch.trim() || undefined
          })
          if (!cancelled) {
            setProjects(list)
            setError(null)
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof ApiError ? err.message : "Failed to load projects")
          }
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [q, language, arch])

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!projects) {
    return <p className="text-sm text-muted-foreground">Loading projects…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a board to browse chunks and check out work.
          </p>
        </div>
        {user ? (
          <Button asChild>
            <Link to="/projects/new">New project</Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or slug" aria-label="Search projects" />
        <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language, e.g. c" aria-label="Filter by language" />
        <Input value={arch} onChange={(e) => setArch(e.target.value)} placeholder="Arch, e.g. x86_64" aria-label="Filter by architecture" />
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet. Seed the API first.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.slug}`} className="block">
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{p.name}</CardTitle>
                    <Badge variant="secondary">{p.language}</Badge>
                  </div>
                  <CardDescription className="font-mono text-xs">{p.slug}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {p.description || "No description"}
                  </p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{p.stats.open} open</span>
                    <span>·</span>
                    <span>{p.stats.leased} leased</span>
                    <span>·</span>
                    <span>{p.stats.matched} matched</span>
                    <span>·</span>
                    <span>{p.stats.stale} stale</span>
                    <span>·</span>
                    <span>{p.stats.total} total</span>
                    <span>·</span>
                    <span>{p.followerCount} followers</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
