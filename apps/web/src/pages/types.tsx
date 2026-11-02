import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  api,
  type ProposalState,
  type TypeEnvironment,
  type TypeProposal,
  type UnresolvedType
} from "@/lib/api"
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

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback
}

export function TypesPage() {
  const { projectSlug = "" } = useParams()
  const { session } = useAuth()
  const { canMaintain, canPropose, ready: roleReady } = useMembership(projectSlug)
  const navigate = useNavigate()

  const [environment, setEnvironment] = React.useState<TypeEnvironment | null>(null)
  const [proposals, setProposals] = React.useState<Array<TypeProposal> | null>(null)
  const [unresolved, setUnresolved] = React.useState<Array<UnresolvedType> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [headers, setHeaders] = React.useState("")
  const headersSeededFor = React.useRef<string | null>(null)
  const [pickedTypes, setPickedTypes] = React.useState<Array<string>>([])
  const [extraTypes, setExtraTypes] = React.useState("")

  const [typeName, setTypeName] = React.useState("")
  const [reason, setReason] = React.useState("")

  const load = React.useCallback(async () => {
    const [env, list, marks] = await Promise.all([
      api.typeEnvironment(projectSlug),
      api.listProposals(projectSlug),
      api.listUnresolved(projectSlug)
    ])
    setEnvironment(env)
    setProposals(list)
    setUnresolved(marks)
    if (headersSeededFor.current !== projectSlug) {
      headersSeededFor.current = projectSlug
      setHeaders(env.headers)
    }
    return list
  }, [projectSlug])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await load()
      } catch (err) {
        if (!cancelled) setError(message(err, "Failed to load types"))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const revalidating = proposals?.some((p) => p.state === "revalidating") ?? false

  React.useEffect(() => {
    if (!revalidating) return
    const id = window.setInterval(() => {
      void load().catch(() => {
        // keep the last good snapshot while a poll fails
      })
    }, 2000)
    return () => window.clearInterval(id)
  }, [revalidating, load])

  async function createProposal(e: React.FormEvent) {
    e.preventDefault()
    if (!session) {
      navigate("/login")
      return
    }
    const extra = extraTypes
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
    const affectedTypes = [...new Set([...pickedTypes, ...extra])]
    setBusy(true)
    setActionError(null)
    try {
      const created = await api.createProposal(
        projectSlug,
        {
          title: title.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          headers,
          ...(affectedTypes.length > 0 ? { affectedTypes } : {})
        },
        session.token
      )
      navigate(`/projects/${projectSlug}/type-proposals/${created.id}`)
    } catch (err) {
      setActionError(message(err, "Could not open proposal"))
    } finally {
      setBusy(false)
    }
  }

  async function mark(e: React.FormEvent) {
    e.preventDefault()
    if (!session) return
    setBusy(true)
    setActionError(null)
    try {
      await api.markUnresolved(
        projectSlug,
        {
          typeName: typeName.trim(),
          ...(reason.trim() ? { reason: reason.trim() } : {})
        },
        session.token
      )
      setTypeName("")
      setReason("")
      await load()
    } catch (err) {
      setActionError(message(err, "Could not mark type unresolved"))
    } finally {
      setBusy(false)
    }
  }

  async function clearMark(name: string) {
    if (!session) return
    setBusy(true)
    setActionError(null)
    try {
      await api.clearUnresolved(projectSlug, name, session.token)
      await load()
    } catch (err) {
      setActionError(message(err, "Could not clear unresolved mark"))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!environment || !proposals || !unresolved) {
    return <p className="text-sm text-muted-foreground">Loading types…</p>
  }

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
          <span>types</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Type environment</h1>
          <Badge variant="secondary">rev {environment.revision}</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Headers are shared by every chunk. A proposal replaces them, then matched
          functions are recompiled. Survivors stay matched. Failures return to the pool
          as stale.
        </p>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Current headers</CardTitle>
            <CardDescription>
              Revision {environment.revision} ·{" "}
              {new Date(environment.createdAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="font-mono max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
              {environment.headers || "(empty)"}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unresolved types</CardTitle>
            <CardDescription>
              Open and stale chunks that use a marked type sit in blocked until the mark
              is cleared.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {unresolved.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active marks.</p>
            ) : (
              <ul className="space-y-2">
                {unresolved.map((mark) => (
                  <li
                    key={mark.id}
                    className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div>
                      <p className="font-mono text-sm">{mark.typeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {mark.reason || "No reason given"} ·{" "}
                        {new Date(mark.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {canMaintain ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void clearMark(mark.typeName)}
                      >
                        Clear
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {!roleReady ? (
              <p className="text-xs text-muted-foreground">Checking your role…</p>
            ) : canMaintain ? (
              <form className="space-y-3 border-t pt-4" onSubmit={(e) => void mark(e)}>
                <div className="space-y-2">
                  <Label htmlFor="typeName">Type name</Label>
                  <Input
                    id="typeName"
                    list="known-types"
                    value={typeName}
                    onChange={(e) => setTypeName(e.target.value)}
                    placeholder="Header"
                    required
                  />
                  <datalist id="known-types">
                    {environment.typeNames.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reason">Reason</Label>
                  <Input
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Layout is still a guess"
                  />
                </div>
                <Button type="submit" disabled={busy || !typeName.trim()}>
                  Mark unresolved
                </Button>
              </form>
            ) : (
              <p className="text-xs text-muted-foreground">
                Owners and maintainers can mark a type unresolved.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Proposals</CardTitle>
          <CardDescription>
            {revalidating
              ? "Revalidation is running. This list refreshes every few seconds."
              : "Anyone can read a proposal. Members can open one."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Revalidation</th>
                <th className="px-4 py-2 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((proposal) => (
                <tr key={proposal.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <Link
                      to={`/projects/${projectSlug}/type-proposals/${proposal.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {proposal.title}
                    </Link>
                    {proposal.affectedTypes.length > 0 ? (
                      <p className="font-mono text-xs text-muted-foreground">
                        {proposal.affectedTypes.join(", ")}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">all matched chunks</p>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={proposalVariant[proposal.state]}>{proposal.state}</Badge>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    {proposal.revalidationDone}/{proposal.revalidationTotal}
                    {proposal.revalidationFailed > 0
                      ? ` · ${proposal.revalidationFailed} failed`
                      : ""}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(proposal.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {proposals.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No proposals yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open a proposal</CardTitle>
          <CardDescription>
            Paste the full replacement headers. Leave affected types empty to revalidate
            every matched chunk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!roleReady ? (
            <p className="text-sm text-muted-foreground">Checking your role…</p>
          ) : canPropose && session ? (
            <form className="space-y-4" onSubmit={(e) => void createProposal(e)}>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              {environment.typeNames.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Affected types</legend>
                  <div className="flex flex-wrap gap-3">
                    {environment.typeNames.map((name) => {
                      const checked = pickedTypes.includes(name)
                      return (
                        <label key={name} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setPickedTypes((prev) =>
                                checked ? prev.filter((n) => n !== name) : [...prev, name]
                              )
                            }
                          />
                          <span className="font-mono text-xs">{name}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="extraTypes">More type names</Label>
                <Input
                  id="extraTypes"
                  value={extraTypes}
                  onChange={(e) => setExtraTypes(e.target.value)}
                  placeholder="comma-separated, optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="headers">Headers</Label>
                <Textarea
                  id="headers"
                  className="font-mono min-h-48"
                  value={headers}
                  onChange={(e) => setHeaders(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" disabled={busy || !title.trim() || !headers.trim()}>
                Open proposal
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link to="/login" className="underline underline-offset-2">
                Log in
              </Link>{" "}
              as a project member to open a type proposal.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
