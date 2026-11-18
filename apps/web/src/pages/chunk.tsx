import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { Diagnostics } from "@/components/diagnostics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  api,
  type SourceLanguage,
  type AttemptResult,
  type AttemptSummary,
  type ChunkSummary,
  type WorkBundle
} from "@/lib/api"
import { downloadWorkBundle } from "@/lib/bundleFiles"
import { useAuth } from "@/lib/auth"
import {
  clearLease as clearStoredLease,
  loadLease,
  saveLease,
  saveLeaseFromCheckout,
  type StoredLease
} from "@/lib/leases"

type Tab = "pseudocode" | "disassembly" | "types" | "bytes" | "best"

const HEARTBEAT_MS = 5 * 60 * 1000

export function ChunkPage() {
  const { projectSlug = "", chunkId = "" } = useParams()
  const { session, user } = useAuth()
  const navigate = useNavigate()

  const [chunk, setChunk] = React.useState<ChunkSummary | null>(null)
  const [maxConcurrentLeases, setMaxConcurrentLeases] = React.useState(1)
  const [bundle, setBundle] = React.useState<WorkBundle | null>(null)
  const [lease, setLease] = React.useState<StoredLease | null>(null)
  const [source, setSource] = React.useState("")
  const [tab, setTab] = React.useState<Tab>("pseudocode")
  const [attempt, setAttempt] = React.useState<AttemptResult | null>(null)
  const [matching, setMatching] = React.useState(false)
  const [attempts, setAttempts] = React.useState<Array<AttemptSummary>>([])
  const [openAttemptId, setOpenAttemptId] = React.useState<string | null>(null)
  const [canClear, setCanClear] = React.useState(false)
  const [languageChoice, setLanguageChoice] = React.useState<"" | SourceLanguage>("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const alive = React.useRef(true)

  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const refreshAttempts = React.useCallback(async () => {
    const list = await api.listAttempts(projectSlug, chunkId)
    setAttempts(list)
  }, [projectSlug, chunkId])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setError(null)
        const [c, list, project] = await Promise.all([
          api.getChunk(projectSlug, chunkId),
          api.listAttempts(projectSlug, chunkId),
          api.getProject(projectSlug)
        ])
        if (cancelled) return
        setChunk(c)
        setLanguageChoice(c.languageOverride === "cpp" || c.languageOverride === "c" ? c.languageOverride : "")
        setAttempts(list)
        setMaxConcurrentLeases(project.maxConcurrentLeases)

        const stored = loadLease(projectSlug, chunkId)
        setLease(stored)

        if (session && stored) {
          try {
            const b = await api.getBundle(projectSlug, chunkId, session.token)
            if (cancelled) return
            setBundle(b)
            setSource((prev) => prev || b.bestAttemptSource || b.pseudocode)
          } catch {
            clearStoredLease(projectSlug, chunkId)
            if (!cancelled) {
              setLease(null)
              setBundle(null)
            }
          }
        }

        if (session) {
          try {
            const membership = await api.membership(projectSlug, session.token)
            if (!cancelled) {
              setCanClear(
                membership.role === "owner" || membership.role === "maintainer"
              )
            }
          } catch {
            if (!cancelled) setCanClear(false)
          }
        } else if (!cancelled) {
          setCanClear(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load chunk")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectSlug, chunkId, session])

  React.useEffect(() => {
    if (!session || !lease) return

    let cancelled = false

    const tick = async () => {
      if (document.visibilityState === "hidden") return
      try {
        const res = await api.heartbeat(
          projectSlug,
          chunkId,
          lease.leaseToken,
          session.token
        )
        if (cancelled) return
        const next: StoredLease = {
          ...lease,
          leaseToken: res.leaseToken,
          leaseExpiresAt: res.leaseExpiresAt,
          holdStartedAt: res.holdStartedAt
        }
        saveLease(next)
        setLease(next)
        setChunk(res.chunk)
      } catch {
        // leave manual heartbeat / release to recover
      }
    }

    const id = window.setInterval(() => {
      void tick()
    }, HEARTBEAT_MS)

    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [session, lease, projectSlug, chunkId])

  async function saveLanguage() {
    if (!session) {
      navigate("/login")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await api.setChunkLanguage(
        projectSlug,
        chunkId,
        languageChoice === "" ? null : languageChoice,
        session.token
      )
      setChunk(updated)
      setLanguageChoice(
        updated.languageOverride === "cpp" || updated.languageOverride === "c"
          ? updated.languageOverride
          : ""
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set the language")
    } finally {
      setBusy(false)
    }
  }

  async function checkout() {
    if (!session) {
      navigate("/login")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.checkout(projectSlug, chunkId, session.token)
      const stored = saveLeaseFromCheckout(projectSlug, res)
      setLease(stored)
      setChunk(res.chunk)
      setBundle(res.bundle)
      setSource(res.bundle.bestAttemptSource ?? res.bundle.pseudocode)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Checkout failed")
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    if (!session || !lease) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.release(projectSlug, chunkId, lease.leaseToken, session.token)
      clearStoredLease(projectSlug, chunkId)
      setLease(null)
      setBundle(null)
      setChunk(c)
      setAttempt(null)
      await refreshAttempts()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Release failed")
    } finally {
      setBusy(false)
    }
  }

  async function clearAsMaintainer() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.clearLease(projectSlug, chunkId, session.token)
      clearStoredLease(projectSlug, chunkId)
      setLease(null)
      setBundle(null)
      setChunk(c)
      setAttempt(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Clear lease failed")
    } finally {
      setBusy(false)
    }
  }

  async function heartbeat() {
    if (!session || !lease) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.heartbeat(projectSlug, chunkId, lease.leaseToken, session.token)
      const next: StoredLease = {
        ...lease,
        leaseToken: res.leaseToken,
        leaseExpiresAt: res.leaseExpiresAt,
        holdStartedAt: res.holdStartedAt
      }
      saveLease(next)
      setLease(next)
      setChunk(res.chunk)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Heartbeat failed")
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!session || !lease) return
    setBusy(true)
    setError(null)
    setAttempt(null)
    setMatching(false)
    try {
      const res = await api.submit(
        projectSlug,
        chunkId,
        lease.leaseToken,
        source,
        session.token
      )
      setAttempt(res)
      setChunk(await api.getChunk(projectSlug, chunkId))
      await refreshAttempts()
      if (res.state === "finished") return

      setMatching(true)
      setBusy(false)
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        if (!alive.current) return
        const list = await api.listAttempts(projectSlug, chunkId)
        if (!alive.current) return
        setAttempts(list)
        const row = list.find((item) => item.id === res.attemptId)
        if (!row?.finishedAt) continue
        setAttempt({
          ...res,
          state: "finished",
          score: row.score,
          matched: row.matched,
          diagnostics: row.diagnostics
        })
        const next = await api.getChunk(projectSlug, chunkId)
        setChunk(next)
        if (next.state === "matched") {
          clearStoredLease(projectSlug, chunkId)
          setLease(null)
          setBundle(null)
        }
        setOpenAttemptId(row.id)
        return
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submit failed")
    } finally {
      setBusy(false)
      setMatching(false)
    }
  }

  if (error && !chunk) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!chunk) {
    return <p className="text-sm text-muted-foreground">Loading chunk…</p>
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "pseudocode", label: "Pseudocode" },
    { id: "disassembly", label: "Disassembly" },
    { id: "types", label: "Types" },
    { id: "bytes", label: "Bytes" },
    { id: "best", label: chunk.state === "stale" ? "Last match" : "Best attempt" }
  ]

  const panel =
    !bundle
      ? "Check out to load the work bundle."
      : tab === "pseudocode"
        ? bundle.pseudocode
        : tab === "disassembly"
          ? bundle.disassembly
          : tab === "types"
            ? bundle.types
            : tab === "bytes"
              ? bundle.originalBytesBase64
              : (bundle.bestAttemptSource ?? "(none)")

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
          <span className="font-mono">{chunk.name}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{chunk.name}</h1>
          <Badge>{chunk.state}</Badge>
        </div>
        {chunk.state === "stale" ? (
          <p className="max-w-2xl text-sm text-muted-foreground">
            The last match was invalidated. Its source stays as the starting attempt and stays out of the matched count until a new match lands. Release and expiry return the chunk here.
          </p>
        ) : null}
        <p className="font-mono text-xs text-muted-foreground">
          {chunk.address} · {chunk.size} bytes
          {bundle ? ` · sha256 ${bundle.meta.bytesSha256.slice(0, 12)}…` : null}
          {maxConcurrentLeases > 1 ? ` · ${chunk.leaseCount}/${maxConcurrentLeases} leases` : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {!lease ? (
          <Button
            onClick={() => void checkout()}
            disabled={
              busy ||
              !(
                chunk.state === "open" ||
                chunk.state === "stale" ||
                (chunk.state === "leased" &&
                  chunk.leaseCount < maxConcurrentLeases &&
                  chunk.leaseUserId !== user?.id)
              )
            }
          >
            {user ? "Check out" : "Log in to check out"}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => void heartbeat()} disabled={busy}>
              Heartbeat now
            </Button>
            <Button variant="outline" onClick={() => void release()} disabled={busy}>
              Release
            </Button>
            {bundle ? (
              <Button variant="outline" onClick={() => downloadWorkBundle(bundle)} disabled={busy}>
                Download bundle
              </Button>
            ) : null}
          </>
        )}
        {canClear ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="chunkLanguage">Language override</Label>
              <select
                id="chunkLanguage"
                value={languageChoice}
                onChange={(e) =>
                  setLanguageChoice(e.target.value === "cpp" || e.target.value === "c" ? e.target.value : "")
                }
                className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="">Project default</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
              </select>
            </div>
            <Button variant="outline" onClick={() => void saveLanguage()} disabled={busy}>
              Save language
            </Button>
          </div>
        ) : null}
        {canClear && chunk.state === "leased" ? (
          <Button variant="destructive" onClick={() => void clearAsMaintainer()} disabled={busy}>
            Clear lease
          </Button>
        ) : null}
      </div>

      {lease ? (
        <p className="text-xs text-muted-foreground">
          Lease expires {new Date(lease.leaseExpiresAt).toLocaleString()} · auto-heartbeat every 5m
          while this page is open · token{" "}
          <span className="font-mono">{lease.leaseToken.slice(0, 8)}…</span>
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Work bundle</CardTitle>
            <CardDescription>
              {bundle
                ? `${bundle.meta.arch} · type rev ${bundle.meta.typeRevision}`
                : "Not loaded"}
            </CardDescription>
            <div className="flex flex-wrap gap-1 pt-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    tab === t.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <pre className="font-mono max-h-[28rem] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
              {panel}
            </pre>
            {tab === "types" ? (
              <p className="mt-3 text-xs text-muted-foreground">
                <Link
                  to={`/projects/${projectSlug}/types`}
                  className="underline underline-offset-2"
                >
                  Project type environment
                </Link>
                {bundle ? ` · revision ${bundle.meta.typeRevision}` : null}
              </p>
            ) : null}
            {bundle && bundle.neighbors.length > 0 ? (
              <div className="mt-4 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Neighbors</p>
                <ul className="space-y-1 text-xs">
                  {bundle.neighbors.map((n) => (
                    <li key={n.chunkId}>
                      <Link
                        to={`/projects/${projectSlug}/chunks/${n.chunkId}`}
                        className="font-mono underline-offset-2 hover:underline"
                      >
                        {n.name} @ {n.address}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Submit translation</CardTitle>
            <CardDescription>
              Source must compile under the project toolchain. Download the bundle, unzip
              it, and point an agent at instructions.agent. Or paste candidate.c here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              className="font-mono min-h-[22rem]"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              disabled={!lease}
              placeholder={lease ? "Paste C source…" : "Check out first"}
            />
            <Button
              onClick={() => void submit()}
              disabled={busy || !lease || !source.trim()}
              className="w-full"
            >
              Submit
            </Button>
            {attempt ? (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
                <p>
                  Attempt <span className="font-mono text-xs">{attempt.attemptId}</span>
                  {attempt.score !== null ? ` · score ${attempt.score.toFixed(3)}` : null}
                </p>
                <Diagnostics
                  text={attempt.diagnostics}
                  matched={attempt.matched}
                  pending={matching || attempt.state !== "finished"}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attempt history</CardTitle>
          <CardDescription>
            Highest score first. Best attempt is what the next lease inherits.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {attempts.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">No attempts yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Who</th>
                  <th className="px-4 py-2 font-medium">Score</th>
                  <th className="px-4 py-2 font-medium">Matched</th>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <React.Fragment key={a.id}>
                  <tr className="border-b align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link
                        to={`/users/${a.userId}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {a.displayName}
                      </Link>
                      {a.best ? (
                        <Badge variant="success" className="ml-2">
                          best
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {a.score === null ? "—" : a.score.toFixed(3)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {a.matched === null ? "pending" : String(a.matched)}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {a.diagnostics ? (
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() =>
                            setOpenAttemptId((current) => (current === a.id ? null : a.id))
                          }
                        >
                          {openAttemptId === a.id ? "Hide" : "Show"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">
                          {a.finishedAt ? "—" : "pending"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {openAttemptId === a.id && a.diagnostics ? (
                    <tr className="border-b last:border-0">
                      <td colSpan={5} className="px-4 py-3">
                        <Diagnostics text={a.diagnostics} matched={a.matched} />
                      </td>
                    </tr>
                  ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
