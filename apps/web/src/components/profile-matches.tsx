import * as React from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, api, type MatchedChunkRef, type MatchesQuery, type UserProjectRef } from "@/lib/api"

const PAGE_SIZE = 25

const selectClass = "h-9 rounded-md border bg-background px-2 text-sm"

/** Profile phase 1: every match, paged, with project, status, and sort filters. */
export function ProfileMatches(props: {
  readonly userId: string
  readonly projects: ReadonlyArray<UserProjectRef>
}) {
  const { userId, projects } = props
  const [project, setProject] = React.useState("")
  const [status, setStatus] = React.useState<"" | "active" | "invalidated">("")
  const [sort, setSort] = React.useState<"newest" | "oldest">("newest")
  const [page, setPage] = React.useState(0)
  const [items, setItems] = React.useState<ReadonlyArray<MatchedChunkRef> | null>(null)
  const [total, setTotal] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    const query: MatchesQuery = {
      sort,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(project ? { project } : {}),
      ...(status ? { status } : {})
    }
    api.userMatches(userId, query).then(
      (result) => {
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
        setError(null)
      },
      (err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load matches") }
    )
    return () => { cancelled = true }
  }, [userId, project, status, sort, page])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const matchedProjects = projects.filter((p) => p.matchCount > 0)

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Matches</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Project"
            className={selectClass}
            value={project}
            onChange={(e) => { setProject(e.target.value); setPage(0) }}
          >
            <option value="">All projects</option>
            {matchedProjects.map((p) => (
              <option key={p.slug} value={p.slug}>{p.name}</option>
            ))}
          </select>
          <select
            aria-label="Status"
            className={selectClass}
            value={status}
            onChange={(e) => {
              const v = e.target.value
              setStatus(v === "active" || v === "invalidated" ? v : "")
              setPage(0)
            }}
          >
            <option value="">Active and invalidated</option>
            <option value="active">Active</option>
            <option value="invalidated">Invalidated</option>
          </select>
          <select
            aria-label="Sort"
            className={selectClass}
            value={sort}
            onChange={(e) => { setSort(e.target.value === "oldest" ? "oldest" : "newest"); setPage(0) }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <span className="text-xs text-muted-foreground">{total} match{total === 1 ? "" : "es"}</span>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {error ? (
          <p className="px-6 pb-6 text-sm text-destructive">{error}</p>
        ) : items === null ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">No matches here.</p>
        ) : (
          <MatchesTable items={items} />
        )}
        {pages > 1 ? (
          <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span>Page {page + 1} of {pages}</span>
            <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function MatchesTable(props: { readonly items: ReadonlyArray<MatchedChunkRef> }) {
  return (
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
        {props.items.map((m) => (
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
              <Link to={`/projects/${m.projectSlug}`} className="underline-offset-2 hover:underline">
                {m.projectName}
              </Link>
            </td>
            <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(m.createdAt).toLocaleString()}</td>
            <td className="px-4 py-2">
              {m.usesInlineAsm ? (
                <Badge variant="outline" className="mr-1" title="Used inline assembly. Not counted toward reputation.">
                  asm
                </Badge>
              ) : null}
              <Badge variant={m.active ? "success" : "outline"}>{m.active ? "active" : "invalidated"}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
