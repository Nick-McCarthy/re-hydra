import * as React from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, type BlockedUser, type ProjectSummary, type UserSearchHit } from "@/lib/api"

/**
 * Audit A-012. Owners and maintainers choose who may work on the project
 * (everyone, or members only) and block users from it. The public activity
 * feed shows that a block happened but not who; names appear only here.
 */
export function ProjectAccessCard(props: {
  readonly project: ProjectSummary
  readonly token: string
  readonly onProjectChanged: (project: ProjectSummary) => void
}) {
  const { project, token, onProjectChanged } = props
  const [blocks, setBlocks] = React.useState<ReadonlyArray<BlockedUser> | null>(null)
  const [query, setQuery] = React.useState("")
  const [hits, setHits] = React.useState<ReadonlyArray<UserSearchHit>>([])
  const [reason, setReason] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api.listBlocks(project.slug, token)
      .then((rows) => { if (!cancelled) setBlocks(rows) })
      .catch((err) => { if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load blocked users") })
    return () => { cancelled = true }
  }, [project.slug, token])

  async function run(action: () => Promise<void>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure)
    } finally {
      setBusy(false)
    }
  }

  const setPolicy = (checkoutPolicy: "open" | "members") =>
    run(async () => {
      onProjectChanged(await api.updateSettings(project.slug, { checkoutPolicy }, token))
    }, "Could not change who may work here")

  const search = () =>
    run(async () => {
      setHits(query.trim().length === 0 ? [] : await api.searchUsers(query.trim()))
    }, "Could not search users")

  const block = (userId: string) =>
    run(async () => {
      setBlocks(await api.blockUser(project.slug, userId, reason.trim(), token))
      setHits([])
      setQuery("")
      setReason("")
    }, "Could not block this user")

  const unblock = (userId: string) =>
    run(async () => {
      setBlocks(await api.unblockUser(project.slug, userId, token))
    }, "Could not lift the block")

  const blockedIds = new Set((blocks ?? []).map((b) => b.userId))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who may work here</CardTitle>
        <CardDescription>
          Open projects take checkouts, submissions, and type proposals from any signed-in
          user. Members only limits that to project members. A blocked user cannot work on
          this project either way, and their current leases here end when you block them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={project.checkoutPolicy === "open" ? "default" : "outline"}
            onClick={() => void setPolicy("open")}
            disabled={busy || project.checkoutPolicy === "open"}
          >
            Open to everyone
          </Button>
          <Button
            variant={project.checkoutPolicy === "members" ? "default" : "outline"}
            onClick={() => void setPolicy("members")}
            disabled={busy || project.checkoutPolicy === "members"}
          >
            Members only
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="blockSearch">Block a user</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="blockSearch"
              placeholder="Display name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void search() }}
              className="w-56"
            />
            <Input
              placeholder="Reason (only maintainers see it)"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              className="w-72"
            />
            <Button variant="outline" onClick={() => void search()} disabled={busy}>
              Search
            </Button>
          </div>
          {hits.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {hits.map((hit) => (
                <li key={hit.id} className="flex items-center gap-2">
                  <span>{hit.displayName}</span>
                  {blockedIds.has(hit.id) ? (
                    <span className="text-xs text-muted-foreground">already blocked</span>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => void block(hit.id)} disabled={busy}>
                      Block
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Blocked users</p>
          {blocks === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is blocked.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {blocks.map((b) => (
                <li key={b.userId} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{b.displayName}</span>
                  <span className="text-xs text-muted-foreground">
                    by {b.blockedByName ?? "a deleted account"}, {new Date(b.createdAt).toLocaleDateString()}
                    {b.reason ? ` · ${b.reason}` : ""}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => void unblock(b.userId)} disabled={busy}>
                    Unblock
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
