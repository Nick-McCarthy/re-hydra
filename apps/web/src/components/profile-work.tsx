import * as React from "react"
import { Link } from "react-router-dom"
import { JoinRequestsWork } from "@/components/join-requests"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, api, type MyWork, type WorkAttempt, type WorkLease } from "@/lib/api"
import { clearLease, loadLease, saveLease } from "@/lib/leases"

const REFRESH_MS = 30_000

function remaining(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now
  if (ms <= 0) return "expired"
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

const resultBadge: Record<WorkAttempt["result"], { label: string; variant: "success" | "outline" | "warning" | "secondary" }> = {
  checking: { label: "checking", variant: "secondary" },
  matched: { label: "matched", variant: "success" },
  missed: { label: "missed", variant: "outline" },
  compile_error: { label: "compile error", variant: "warning" }
}

/**
 * Profile phase 1. The signed-in user's leases across every project, with a
 * countdown and heartbeat/release, plus submissions still being checked and
 * the last few results. Refreshes every 30 seconds.
 */
export function ProfileWork(props: { readonly token: string }) {
  const { token } = props
  const [work, setWork] = React.useState<MyWork | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(() => Date.now())

  const load = React.useCallback(async () => {
    try {
      setWork(await api.myWork(token))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your work")
    }
  }, [token])

  React.useEffect(() => {
    void load()
    const refresh = window.setInterval(() => void load(), REFRESH_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(refresh)
      window.clearInterval(tick)
    }
  }, [load])

  async function act(lease: WorkLease, action: "heartbeat" | "release") {
    setBusy(lease.leaseToken)
    setError(null)
    try {
      if (action === "heartbeat") {
        const next = await api.heartbeat(lease.projectSlug, lease.chunkId, lease.leaseToken, token)
        // Keep the chunk page's stored lease in step when this browser holds it.
        if (loadLease(lease.projectSlug, lease.chunkId)?.leaseToken === lease.leaseToken) {
          saveLease({
            projectSlug: lease.projectSlug,
            chunkId: lease.chunkId,
            leaseToken: next.leaseToken,
            leaseExpiresAt: next.leaseExpiresAt,
            holdStartedAt: next.holdStartedAt
          })
        }
      } else {
        await api.release(lease.projectSlug, lease.chunkId, lease.leaseToken, token)
        if (loadLease(lease.projectSlug, lease.chunkId)?.leaseToken === lease.leaseToken) {
          clearLease(lease.projectSlug, lease.chunkId)
        }
      }
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action === "heartbeat" ? "extend" : "release"} the lease`)
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (work === null) {
    return error
      ? <p className="text-sm text-destructive">{error}</p>
      : <p className="text-sm text-muted-foreground">Loading your work…</p>
  }

  return (
    <div className="space-y-6">
      <JoinRequestsWork token={token} />
      <Card>
        <CardHeader>
          <CardTitle>Leases you hold</CardTitle>
          <CardDescription>
            Across every project, soonest to expire first. A competing lease is a place in line
            behind the current holder.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {work.leases.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              You hold no leases. <Link to="/projects" className="underline underline-offset-2">Find a project</Link> to
              check out a chunk.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Chunk</th>
                  <th className="px-4 py-2 font-medium">Project</th>
                  <th className="px-4 py-2 font-medium">Expires in</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {work.leases.map((lease) => {
                  const left = remaining(lease.leaseExpiresAt, now)
                  const soon = new Date(lease.leaseExpiresAt).getTime() - now < 5 * 60_000
                  return (
                    <tr key={lease.leaseToken} className="border-b last:border-0">
                      <td className="px-4 py-2">
                        <Link
                          to={`/projects/${lease.projectSlug}/chunks/${lease.chunkId}`}
                          className="font-mono text-xs underline-offset-2 hover:underline"
                        >
                          {lease.chunkName}
                        </Link>
                        {lease.kind === "competing" ? (
                          <Badge variant="outline" className="ml-2">competing</Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-2">
                        <Link to={`/projects/${lease.projectSlug}`} className="underline-offset-2 hover:underline">
                          {lease.projectName}
                        </Link>
                      </td>
                      <td className={`px-4 py-2 font-mono text-xs ${soon ? "text-destructive" : ""}`}>{left}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => void act(lease, "heartbeat")}
                          >
                            Extend
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => void act(lease, "release")}
                          >
                            Release
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <AttemptsCard
        title="Being checked"
        description="Submissions matchd has not finished yet."
        empty="Nothing is being checked."
        attempts={work.checking}
      />
      <AttemptsCard
        title="Recent results"
        description="Your last ten finished submissions."
        empty="No finished submissions yet."
        attempts={work.recent}
      />
    </div>
  )
}

function AttemptsCard(props: {
  readonly title: string
  readonly description: string
  readonly empty: string
  readonly attempts: ReadonlyArray<WorkAttempt>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {props.attempts.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">{props.empty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody>
              {props.attempts.map((a) => {
                const badge = resultBadge[a.result]
                return (
                  <tr key={a.attemptId} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        to={`/projects/${a.projectSlug}/chunks/${a.chunkId}`}
                        className="font-mono text-xs underline-offset-2 hover:underline"
                      >
                        {a.chunkName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{a.projectName}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(a.finishedAt ?? a.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {a.result === "missed" && a.score !== null ? (
                        <span className="ml-2 text-xs text-muted-foreground">{Math.round(a.score * 100)}%</span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
