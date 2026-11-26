import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError, api, type ProposalState, type TypeProposal } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useMembership } from "@/lib/membership"

const proposalVariant: Record<
  ProposalState,
  "default" | "secondary" | "outline" | "success" | "warning"
> = {
  open: "success",
  revalidating: "warning",
  ready: "secondary",
  accepted: "default",
  rejected: "outline",
  withdrawn: "secondary"
}

function outcome(proposal: TypeProposal): string {
  if (proposal.state === "open") {
    return "A maintainer starts revalidation. Matched functions compile again under these headers."
  }
  if (proposal.state === "revalidating") {
    return "matchd is recompiling the affected matches. This page refreshes until that finishes."
  }
  if (proposal.state === "ready") {
    const failed =
      proposal.revalidationFailed > 0
        ? `${proposal.revalidationFailed} failed and stay stale. `
        : ""
    const unchecked =
      proposal.revalidationUnchecked > 0
        ? `${proposal.revalidationUnchecked} could not be checked (the compile failed or an input was missing); their matches stay. `
        : ""
    return `${failed}${unchecked}Revalidation finished. Another owner or maintainer accepts these headers.`
  }
  if (proposal.state === "accepted" && proposal.revalidationTotal === 0) {
    return "No matched functions were in scope. These headers are now the current revision."
  }
  if (proposal.state === "accepted" && proposal.revalidationUnchecked > 0) {
    return `${proposal.revalidationFailed} failed and returned to the pool as stale. ${proposal.revalidationUnchecked} could not be checked (the compile failed or an input was missing); their matches stay. The proposal landed.`
  }
  if (proposal.state === "accepted" && proposal.revalidationFailed === 0) {
    return "Every rechecked function still matches and is pinned to the new revision."
  }
  if (proposal.state === "accepted") {
    return `${proposal.revalidationFailed} function${proposal.revalidationFailed === 1 ? "" : "s"} failed and returned to the pool as stale. The proposal still landed.`
  }
  return "This proposal is closed."
}

export function ProposalPage() {
  const { projectSlug = "", proposalId = "" } = useParams()
  const { session } = useAuth()
  const { canMaintain, ready: roleReady } = useMembership(projectSlug)
  const [proposal, setProposal] = React.useState<TypeProposal | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    const next = await api.getProposal(projectSlug, proposalId)
    setProposal(next)
    return next
  }, [projectSlug, proposalId])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await refresh()
        if (cancelled) return
        setProposal(next)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load proposal")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  React.useEffect(() => {
    if (proposal?.state !== "revalidating") return
    const id = window.setInterval(() => {
      void refresh().catch(() => {
        // keep showing the last snapshot
      })
    }, 2000)
    return () => window.clearInterval(id)
  }, [proposal?.state, refresh])

  async function revalidate() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.startRevalidation(projectSlug, proposalId, session.token)
      setProposal(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Revalidation failed to start")
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.acceptProposal(projectSlug, proposalId, session.token)
      setProposal(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Accept failed")
    } finally {
      setBusy(false)
    }
  }

  if (error && !proposal) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!proposal) {
    return <p className="text-sm text-muted-foreground">Loading proposal…</p>
  }

  const finished = proposal.revalidationDone + proposal.revalidationFailed + proposal.revalidationUnchecked
  const progress =
    proposal.revalidationTotal === 0
      ? proposal.state === "open"
        ? 0
        : 100
      : Math.min(100, Math.round((finished / proposal.revalidationTotal) * 100))

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link to="/projects" className="underline underline-offset-2">
            Projects
          </Link>
          <span className="mx-2">/</span>
          <Link to={`/projects/${projectSlug}`} className="underline underline-offset-2">
            {projectSlug}
          </Link>
          <span className="mx-2">/</span>
          <Link to={`/projects/${projectSlug}/types`} className="underline underline-offset-2">
            types
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{proposal.title}</h1>
          <Badge variant={proposalVariant[proposal.state]}>{proposal.state}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Opened by{" "}
          {proposal.createdBy !== null ? (
            <Link
              to={`/users/${proposal.createdBy}`}
              className="underline underline-offset-2"
            >
              {proposal.createdBy.slice(0, 8)}
            </Link>
          ) : (
            "a deleted account"
          )}{" "}
          · {new Date(proposal.createdAt).toLocaleString()}
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Revalidation</CardTitle>
          <CardDescription>{outcome(proposal)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {proposal.revalidationDone} matched · {proposal.revalidationFailed} failed ·{" "}
            {proposal.revalidationUnchecked > 0 ? `${proposal.revalidationUnchecked} not checked · ` : ""}
            {proposal.revalidationTotal} total
          </p>
          <p className="text-sm">
            Scope:{" "}
            {proposal.affectedTypes.length > 0 ? (
              <span className="font-mono text-xs">{proposal.affectedTypes.join(", ")}</span>
            ) : (
              "every matched chunk"
            )}
          </p>
          {proposal.description ? (
            <p className="text-sm text-muted-foreground">{proposal.description}</p>
          ) : null}
          {roleReady && canMaintain && proposal.state === "open" && session ? (
            <Button onClick={() => void revalidate()} disabled={busy}>
              Start revalidation
            </Button>
          ) : null}
          {roleReady && proposal.state === "open" && !canMaintain ? (
            <p className="text-xs text-muted-foreground">
              An owner or maintainer starts revalidation.
            </p>
          ) : null}
          {roleReady &&
          canMaintain &&
          proposal.state === "ready" &&
          session &&
          (proposal.reviewerCount < 2 || session.user.id !== proposal.revalidationStartedBy) ? (
            <Button onClick={() => void accept()} disabled={busy}>
              {proposal.revalidationFailed > 0
                ? `Accept · ${proposal.revalidationFailed} failed`
                : "Accept"}
            </Button>
          ) : null}
          {roleReady &&
          canMaintain &&
          proposal.state === "ready" &&
          session &&
          proposal.reviewerCount >= 2 &&
          session.user.id === proposal.revalidationStartedBy ? (
            <p className="text-xs text-muted-foreground">
              Another owner or maintainer accepts this proposal.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proposed headers</CardTitle>
          <CardDescription>Full replacement for the project type environment.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="font-mono max-h-[32rem] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
            {proposal.headers ?? "(headers unavailable)"}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
