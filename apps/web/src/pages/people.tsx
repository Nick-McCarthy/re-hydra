import * as React from "react"
import { Link } from "react-router-dom"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ApiError, api, type UserSearchHit } from "@/lib/api"

export function PeoplePage() {
  const [q, setQ] = React.useState("")
  const [hits, setHits] = React.useState<Array<UserSearchHit> | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const trimmed = q.trim()
    if (trimmed.length === 0) {
      setHits([])
      setError(null)
      return
    }
    setHits(null)
    let cancelled = false
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const list = await api.searchUsers(trimmed)
          if (!cancelled) {
            setHits(list)
            setError(null)
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof ApiError ? err.message : "Search failed")
          }
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [q])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by display name. Reputation is surviving matches minus type-proposal regressions.
        </p>
      </div>
      <Input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Display name"
        aria-label="Search users"
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {hits === null && q.trim().length > 0 ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : null}
      {hits && hits.length === 0 && q.trim().length > 0 ? (
        <p className="text-sm text-muted-foreground">No people match that name.</p>
      ) : null}
      {hits && hits.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>{hits.length} shown</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {hits.map((hit) => (
              <div key={hit.id} className="flex items-center justify-between gap-3 text-sm">
                <Link
                  to={`/users/${hit.id}`}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {hit.displayName}
                </Link>
                <span className="text-xs text-muted-foreground">
                  reputation {hit.reputation} · {hit.survivingMatches} surviving · {hit.regressions}{" "}
                  regressions
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
