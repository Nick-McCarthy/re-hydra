import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Diagnostics } from "@/components/diagnostics"
import { Dialog } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  api,
  type AttemptResult,
  type ChunkSummary,
  type SourceLanguage,
  type WorkBundle
} from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { downloadWorkBundle } from "@/lib/bundleFiles"
import {
  clearLease as clearStoredLease,
  loadLease,
  saveLease,
  type StoredLease
} from "@/lib/leases"

type Tab = "pseudocode" | "disassembly" | "types" | "bytes" | "best" | "integration"

export function ChunkWorkDialog({
  open,
  projectSlug,
  chunkId,
  canMaintain,
  onClose,
  onChanged
}: {
  open: boolean
  projectSlug: string
  chunkId: string
  canMaintain: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const alive = React.useRef(true)
  const [chunk, setChunk] = React.useState<ChunkSummary | null>(null)
  const [bundle, setBundle] = React.useState<WorkBundle | null>(null)
  const [lease, setLease] = React.useState<StoredLease | null>(null)
  const [source, setSource] = React.useState("")
  const [tab, setTab] = React.useState<Tab>("pseudocode")
  const [attempt, setAttempt] = React.useState<AttemptResult | null>(null)
  const [matching, setMatching] = React.useState(false)
  const [languageChoice, setLanguageChoice] = React.useState<"" | SourceLanguage>("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setAttempt(null)
    const stored = loadLease(projectSlug, chunkId)
    setLease(stored)
    const started = performance.now()
    console.log(`[work] open ${projectSlug}/${chunkId} lease=${stored !== null}`)
    void (async () => {
      try {
        const chunkStarted = performance.now()
        const next = await api.getChunk(projectSlug, chunkId)
        console.log(`[work] getChunk ${Math.round(performance.now() - chunkStarted)}ms state=${next.state}`)
        if (cancelled) return
        setChunk(next)
        setLanguageChoice(
          next.languageOverride === "cpp" || next.languageOverride === "c" ? next.languageOverride : ""
        )
        if (session && stored) {
          const bundleStarted = performance.now()
          const loaded = await api.getBundle(projectSlug, chunkId, session.token)
          console.log(`[work] getBundle ${Math.round(performance.now() - bundleStarted)}ms`)
          if (cancelled) return
          setBundle(loaded)
          setSource(loaded.bestAttemptSource ?? loaded.pseudocode)
        } else {
          console.log("[work] no bundle (signed out or no lease)")
          setBundle(null)
          setSource("")
        }
        console.log(`[work] ready ${Math.round(performance.now() - started)}ms`)
      } catch (err) {
        console.log(`[work] failed ${Math.round(performance.now() - started)}ms`, err)
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load this function")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, projectSlug, chunkId, session])

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
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set the language")
    } finally {
      setBusy(false)
    }
  }

  async function toggleInlineAsm(allow: boolean) {
    if (!session) {
      navigate("/login")
      return
    }
    if (!allow && chunk?.matchUsesInlineAsm) {
      const ok = window.confirm(
        "The current match uses inline assembly. Turning this off invalidates that match and returns the function to the pool as stale."
      )
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await api.setChunkInlineAsm(projectSlug, chunkId, allow, session.token)
      setChunk(updated)
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the inline assembly setting")
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    if (!session || !lease) return
    setBusy(true)
    setError(null)
    try {
      const next = await api.release(projectSlug, chunkId, lease.leaseToken, session.token)
      clearStoredLease(projectSlug, chunkId)
      setLease(null)
      setBundle(null)
      setChunk(next)
      setAttempt(null)
      onChanged()
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
      const next = await api.clearLease(projectSlug, chunkId, session.token)
      clearStoredLease(projectSlug, chunkId)
      setLease(null)
      setBundle(null)
      setChunk(next)
      setAttempt(null)
      onChanged()
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
      const res = await api.submit(projectSlug, chunkId, lease.leaseToken, source, session.token)
      setAttempt(res)
      setChunk(await api.getChunk(projectSlug, chunkId))
      if (res.state === "finished") {
        onChanged()
        return
      }
      setMatching(true)
      setBusy(false)
      for (let i = 0; i < 30; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000))
        if (!alive.current) return
        const list = await api.listAttempts(projectSlug, chunkId)
        if (!alive.current) return
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
        onChanged()
        return
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Submit failed")
    } finally {
      setBusy(false)
      setMatching(false)
    }
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "pseudocode", label: "Pseudocode" },
    { id: "disassembly", label: "Disassembly" },
    { id: "types", label: "Types" },
    { id: "bytes", label: "Bytes" },
    { id: "best", label: chunk?.state === "stale" ? "Last match" : "Best attempt" },
    ...(bundle?.integrationNote !== undefined ? [{ id: "integration" as const, label: "Link failure" }] : [])
  ]
  const panel = !bundle
    ? "Check out this function to load the work bundle."
    : tab === "pseudocode"
      ? bundle.pseudocode
      : tab === "disassembly"
        ? bundle.disassembly
        : tab === "types"
          ? bundle.types
          : tab === "bytes"
            ? bundle.originalBytesBase64
            : tab === "integration"
              ? (bundle.integrationNote ?? "(none)")
              : (bundle.bestAttemptSource ?? "(none)")

  return (
    <Dialog open={open} title={chunk?.name ?? "Function"} onClose={onClose}>
      <div className="space-y-4">
        {chunk ? (
          <p className="font-mono text-xs text-muted-foreground">
            {chunk.address} · {chunk.size} bytes · {chunk.state}
            {bundle ? ` · sha256 ${bundle.meta.bytesSha256.slice(0, 12)}…` : null}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          {lease ? (
            <>
              <Button type="button" variant="secondary" onClick={() => void heartbeat()} disabled={busy}>
                Heartbeat now
              </Button>
              <Button type="button" variant="outline" onClick={() => void release()} disabled={busy}>
                Release
              </Button>
              {bundle ? (
                <Button type="button" variant="outline" onClick={() => downloadWorkBundle(bundle)} disabled={busy}>
                  Download bundle
                </Button>
              ) : null}
            </>
          ) : null}
          {canMaintain ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="chunkLanguage">Language override</Label>
                <select
                  id="chunkLanguage"
                  value={languageChoice}
                  onChange={(event) =>
                    setLanguageChoice(event.target.value === "cpp" || event.target.value === "c" ? event.target.value : "")
                  }
                  className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">Project default</option>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                </select>
              </div>
              <Button type="button" variant="outline" onClick={() => void saveLanguage()} disabled={busy}>
                Save language
              </Button>
              <label
                className="flex items-center gap-2 text-sm"
                title="Off by default. Inline assembly can copy the original bytes without translating them, so only allow it for code that really was assembly. Matches that use it are marked."
              >
                <input
                  type="checkbox"
                  checked={chunk?.allowInlineAsm ?? false}
                  disabled={busy || chunk === null}
                  onChange={(event) => void toggleInlineAsm(event.target.checked)}
                />
                Allow inline assembly
              </label>
            </>
          ) : null}
          {canMaintain && chunk?.state === "leased" ? (
            <Button type="button" variant="destructive" onClick={() => void clearAsMaintainer()} disabled={busy}>
              Clear lease
            </Button>
          ) : null}
        </div>
        {lease ? (
          <p className="text-xs text-muted-foreground">
            Lease expires {new Date(lease.leaseExpiresAt).toLocaleString()}. Leaving this project page
            open extends it about every five minutes.
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Work bundle</h3>
              {bundle ? <Badge variant="secondary">rev {bundle.meta.typeRevision}</Badge> : null}
            </div>
            <div className="flex flex-wrap gap-1">
              {tabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    tab === item.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <pre className="font-mono max-h-80 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
              {panel}
            </pre>
            {tab === "types" ? (
              <p className="text-xs text-muted-foreground">
                <Link to={`/projects/${projectSlug}/types`} className="underline underline-offset-2">
                  Project type environment
                </Link>
              </p>
            ) : null}
            {bundle && bundle.neighbors.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Calls{" "}
                {bundle.neighbors.map((neighbor, index) => (
                  <span key={neighbor.chunkId}>
                    {index > 0 ? ", " : null}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => navigate(`/projects/${projectSlug}?work=${neighbor.chunkId}`)}
                    >
                      {neighbor.name}
                    </button>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Submit translation</h3>
            <p className="text-sm text-muted-foreground">
              Download the bundle, unzip it, and point an agent at instructions.agent. Or paste
              candidate.c here.
            </p>
            <Textarea
              className="min-h-64 font-mono"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              disabled={!lease}
              placeholder={lease ? "Paste C source…" : "Check out first"}
            />
            <Button
              type="button"
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
          </div>
        </div>
      </div>
    </Dialog>
  )
}
