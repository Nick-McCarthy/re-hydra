import * as React from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { AttemptHistoryDialog } from "@/components/attempt-history-dialog"
import { ChunkWorkDialog } from "@/components/chunk-work-dialog"
import { ProjectAccessCard } from "@/components/project-access-card"
import { ProjectMembersCard } from "@/components/project-members-card"
import { ActivityList } from "@/components/activity-list"
import { FollowButton } from "@/components/follow-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ApiError,
  api,
  type ChunkState,
  type ChunkSummary,
  type Integration,
  type ProjectEvent,
  type ProjectSummary,
  type SourceLanguage
} from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { clearLease, loadLease, saveLease, saveLeaseFromCheckout } from "@/lib/leases"
import { explainExport, importFailureMessage } from "@/lib/import-errors"
import { useMembership } from "@/lib/membership"

const stateVariant: Record<
  ChunkState,
  "default" | "secondary" | "outline" | "success" | "warning"
> = {
  open: "success",
  leased: "warning",
  validating: "secondary",
  matched: "default",
  stale: "outline",
  blocked: "outline"
}

const fuseable = new Set<ChunkState>(["open", "stale", "matched"])

function ChunkQuery({ onChange }: { onChange: (value: string) => void }) {
  const [query, setQuery] = React.useState("")
  const skip = React.useRef(true)

  React.useEffect(() => {
    if (skip.current) {
      skip.current = false
      return
    }
    const handle = window.setTimeout(() => onChange(query.trim()), 200)
    return () => window.clearTimeout(handle)
  }, [query, onChange])

  return (
    <Input
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Name or address"
      aria-label="Filter functions by name or address"
      className="ml-auto w-56"
    />
  )
}

function canCheckout(
  chunk: ChunkSummary,
  maxConcurrentLeases: number,
  userId: string | undefined
): boolean {
  return (
    chunk.state === "open" ||
    chunk.state === "stale" ||
    (chunk.state === "leased" &&
      chunk.leaseCount < maxConcurrentLeases &&
      chunk.leaseUserId !== userId)
  )
}

function IntegrationRun({
  projectSlug,
  integration
}: {
  projectSlug: string
  integration: Integration
}) {
  return (
    <div className="space-y-2 border-t pt-3 text-sm first:border-t-0 first:pt-0">
      <p>
        <Badge
          variant={
            integration.status === "passed"
              ? "success"
              : integration.status === "failed" || integration.status === "error"
                ? "outline"
                : "secondary"
          }
        >
          {integration.status}
        </Badge>
        <span className="ml-2">{integration.summary}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {new Date(integration.createdAt).toLocaleString()}
        </span>
      </p>
      {integration.diagnostics ? (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
          {integration.diagnostics}
        </pre>
      ) : null}
      <ul className="space-y-2">
        {integration.units.map((unit) => (
          <li key={unit.chunkId}>
            <Link
              to={`/projects/${projectSlug}/chunks/${unit.chunkId}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {unit.name}
            </Link>
            <span className="ml-2 text-muted-foreground">
              {unit.passed === null
                ? "pending"
                : unit.passed
                  ? "matched"
                  : integration.status === "error"
                    ? "not linked"
                    : "reopened"}
            </span>
            {unit.detail ? (
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {unit.detail}
              </pre>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

const CHUNK_PAGE_SIZE = 100

function timed<T>(label: string, work: Promise<T>): Promise<T> {
  const started = performance.now()
  console.log(`[project] start ${label}`)
  return work.then(
    (value) => {
      const count = Array.isArray(value) ? ` count=${value.length}` : ""
      console.log(`[project] done ${label} ${Math.round(performance.now() - started)}ms${count}`)
      return value
    },
    (err) => {
      console.log(`[project] fail ${label} ${Math.round(performance.now() - started)}ms`, err)
      throw err
    }
  )
}

export function ProjectPage() {
  const { projectSlug = "" } = useParams()
  const { session, user } = useAuth()
  const { canMaintain, role: myRole, reload: reloadMembership, ready: roleReady } = useMembership(projectSlug)
  // Bumped when the access card changes membership (blocking removes a contributor).
  const [membersKey, setMembersKey] = React.useState(0)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [project, setProject] = React.useState<ProjectSummary | null>(null)
  const [chunks, setChunks] = React.useState<Array<ChunkSummary> | null>(null)
  const [typeRevision, setTypeRevision] = React.useState<number | null>(null)
  const [filter, setFilter] = React.useState<ChunkState | "all">("all")
  const [chunkQuery, setChunkQuery] = React.useState("")
  const [page, setPage] = React.useState(0)
  const applyChunkQuery = React.useCallback((value: string) => {
    setChunkQuery(value)
    setPage(0)
  }, [])
  const [selected, setSelected] = React.useState<Array<string>>([])
  const [fuseName, setFuseName] = React.useState("")
  const [events, setEvents] = React.useState<Array<ProjectEvent>>([])
  const [leaseCap, setLeaseCap] = React.useState("1")
  const [holdCap, setHoldCap] = React.useState("8")
  const [checkoutNote, setCheckoutNote] = React.useState<string | null>(null)
  const [integrations, setIntegrations] = React.useState<Array<Integration>>([])
  const [recipeLanguage, setRecipeLanguage] = React.useState<SourceLanguage>("c")
  const [flags, setFlags] = React.useState("-O2")
  const [linkLanguage, setLinkLanguage] = React.useState<SourceLanguage>("c")
  const [linkBinary, setLinkBinary] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [importBusy, setImportBusy] = React.useState(false)
  const [importNote, setImportNote] = React.useState<string | null>(null)
  const [importError, setImportError] = React.useState<string | null>(null)
  const [importOver, setImportOver] = React.useState(false)
  const importInput = React.useRef<HTMLInputElement>(null)

  const reload = React.useCallback(async () => {
    const started = performance.now()
    console.log(`[project] reload ${projectSlug}`)
    const [p, c, env, activity, links] = await Promise.all([
      timed("getProject", api.getProject(projectSlug)),
      timed("listChunks", api.listChunks(projectSlug)),
      timed("typeEnvironment", api.typeEnvironment(projectSlug).catch(() => null)),
      timed("activity", api.projectActivity(projectSlug).catch(() => [])),
      timed("integrations", api.listIntegrations(projectSlug).catch(() => []))
    ])
    console.log(`[project] reload fetched ${Math.round(performance.now() - started)}ms`)
    setProject(p)
    setChunks(c)
    setTypeRevision(env?.revision ?? null)
    setEvents(activity)
    setIntegrations(links)
    setLeaseCap(String(p.maxConcurrentLeases))
    setHoldCap(String(p.maxHeldChunks))
    setRecipeLanguage(p.language === "cpp" ? "cpp" : "c")
    setFlags(p.toolchain.flags.join(" "))
  }, [projectSlug])

  React.useEffect(() => {
    let cancelled = false
    const started = performance.now()
    console.log(`[project] first load ${projectSlug}`)
    void (async () => {
      try {
        const [p, c, env, activity, links] = await Promise.all([
          timed("getProject", api.getProject(projectSlug)),
          timed("listChunks", api.listChunks(projectSlug)),
          timed("typeEnvironment", api.typeEnvironment(projectSlug).catch(() => null)),
          timed("activity", api.projectActivity(projectSlug).catch(() => [])),
          timed("integrations", api.listIntegrations(projectSlug).catch(() => []))
        ])
        console.log(`[project] first load fetched ${Math.round(performance.now() - started)}ms`)
        if (!cancelled) {
          setProject(p)
          setChunks(c)
          setTypeRevision(env?.revision ?? null)
          setEvents(activity)
          setIntegrations(links)
          setLeaseCap(String(p.maxConcurrentLeases))
          setHoldCap(String(p.maxHeldChunks))
          setRecipeLanguage(p.language === "cpp" ? "cpp" : "c")
          setFlags(p.toolchain.flags.join(" "))
          console.log(
            `[project] state set ${Math.round(performance.now() - started)}ms chunks=${c.length} events=${activity.length}`
          )
        }
      } catch (err) {
        console.log(`[project] first load failed ${Math.round(performance.now() - started)}ms`, err)
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load project")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectSlug])

  React.useEffect(() => {
    if (!project || !chunks) {
      console.log("[project] still showing Loading project…")
      return
    }
    const started = performance.now()
    console.log(
      `[project] commit chunks=${chunks.length} events=${events.length}; table page size ${CHUNK_PAGE_SIZE}`
    )
    const frame = window.requestAnimationFrame(() => {
      console.log(`[project] frame ${Math.round(performance.now() - started)}ms after commit`)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [project, chunks, events.length])

  async function importFile(file: File) {
    if (!session) return
    setImportBusy(true)
    setImportError(null)
    setImportNote(`Reading ${file.name}…`)
    try {
      const jsonText = await file.text()
      const problem = explainExport(jsonText)
      if (problem) {
        setImportNote(null)
        setImportError(problem)
        return
      }
      setImportNote(`Importing ${file.name}…`)
      const result = await api.importExport(projectSlug, jsonText, session.token)
      setImportNote(
        `Imported ${result.functionsCreated} new ${result.functionsCreated === 1 ? "chunk" : "chunks"}` +
          (result.functionsUpdated > 0 ? ` and updated ${result.functionsUpdated}.` : ".")
      )
      await reload()
    } catch (err) {
      setImportNote(null)
      setImportError(
        err instanceof ApiError ? importFailureMessage(err) : "Could not read that file."
      )
    } finally {
      setImportBusy(false)
      if (importInput.current) importInput.current.value = ""
    }
  }

  const integrationActive = integrations.some(
    (row) => row.status === "queued" || row.status === "running"
  )

  React.useEffect(() => {
    if (!integrationActive) return
    const timer = window.setInterval(() => {
      void reload().catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [integrationActive, reload])

  React.useEffect(() => {
    if (!session || !chunks) return
    const token = session.token
    const held = chunks
    let cancelled = false
    async function beat() {
      for (const chunk of held) {
        const lease = loadLease(projectSlug, chunk.id)
        if (!lease || cancelled) continue
        try {
          const res = await api.heartbeat(projectSlug, chunk.id, lease.leaseToken, token)
          if (cancelled) return
          saveLease({
            ...lease,
            leaseToken: res.leaseToken,
            leaseExpiresAt: res.leaseExpiresAt,
            holdStartedAt: res.holdStartedAt
          })
        } catch {
          if (!cancelled) clearLease(projectSlug, chunk.id)
        }
      }
    }
    const timer = window.setInterval(() => {
      void beat()
    }, 5 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [session, chunks, projectSlug])

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!project || !chunks) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>
  }

  const needle = chunkQuery.toLowerCase()
  const queried =
    needle.length === 0
      ? chunks
      : chunks.filter(
          (chunk) =>
            chunk.name.toLowerCase().includes(needle) ||
            chunk.address.toLowerCase().includes(needle)
        )
  const visible = filter === "all" ? queried : queried.filter((c) => c.state === filter)
  const pageCount = Math.max(1, Math.ceil(visible.length / CHUNK_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageStart = currentPage * CHUNK_PAGE_SIZE
  const pageRows = visible.slice(pageStart, pageStart + CHUNK_PAGE_SIZE)
  const workId = searchParams.get("work")
  const attemptsId = searchParams.get("attempts")
  const leaseSlots = project.maxConcurrentLeases
  const checkoutCount = chunks.filter(
    (chunk) => selected.includes(chunk.id) && canCheckout(chunk, leaseSlots, user?.id)
  ).length
  const heldIds = new Set(
    chunks
      .filter((chunk) => {
        if (user && chunk.leaseUserId === user.id) return true
        return (
          (chunk.state === "leased" || chunk.state === "validating") &&
          loadLease(projectSlug, chunk.id) !== null
        )
      })
      .map((chunk) => chunk.id)
  )

  function selectable(chunk: ChunkSummary): boolean {
    if (canCheckout(chunk, leaseSlots, user?.id)) return true
    return canMaintain && fuseable.has(chunk.state)
  }

  function toggle(chunk: ChunkSummary) {
    if (!selectable(chunk) && !selected.includes(chunk.id)) return
    setSelected((prev) =>
      prev.includes(chunk.id) ? prev.filter((id) => id !== chunk.id) : [...prev, chunk.id]
    )
  }

  function setQuery(key: "work" | "attempts", value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  async function saveLeaseCap() {
    if (!session) {
      navigate("/login")
      return
    }
    const next = Number(leaseCap)
    if (!Number.isInteger(next) || next < 1 || next > 8) {
      setActionError("Competing leases must be a whole number from 1 to 8")
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const updated = await api.updateSettings(
        projectSlug,
        { maxConcurrentLeases: next },
        session.token
      )
      setProject(updated)
      setLeaseCap(String(updated.maxConcurrentLeases))
      setHoldCap(String(updated.maxHeldChunks))
      setEvents(await api.projectActivity(projectSlug))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save settings")
    } finally {
      setBusy(false)
    }
  }

  async function saveHoldCap() {
    if (!session) {
      navigate("/login")
      return
    }
    const next = Number(holdCap)
    if (!Number.isInteger(next) || next < 1 || next > 32) {
      setActionError("Chunks one person may hold must be a whole number from 1 to 32")
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const updated = await api.updateSettings(projectSlug, { maxHeldChunks: next }, session.token)
      setProject(updated)
      setHoldCap(String(updated.maxHeldChunks))
      setEvents(await api.projectActivity(projectSlug))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save settings")
    } finally {
      setBusy(false)
    }
  }

  async function checkoutSelected() {
    if (!session || !project || !chunks) {
      navigate("/login")
      return
    }
    const targets = chunks.filter(
      (chunk) => selected.includes(chunk.id) && canCheckout(chunk, project.maxConcurrentLeases, user?.id)
    )
    if (targets.length === 0) return
    setBusy(true)
    setCheckoutNote(null)
    setActionError(null)
    const checkedOut: Array<string> = []
    const checkedIds: Array<string> = []
    const taken: Array<string> = []
    const limited: Array<string> = []
    let room = Math.max(0, project.maxHeldChunks - heldIds.size)
    try {
      for (const chunk of targets) {
        if (room <= 0) {
          limited.push(chunk.name)
          continue
        }
        try {
          const res = await api.checkout(projectSlug, chunk.id, session.token)
          saveLeaseFromCheckout(projectSlug, res)
          checkedOut.push(chunk.name)
          checkedIds.push(chunk.id)
          room -= 1
        } catch (err) {
          const limitedHit = err instanceof ApiError && err.message.includes("already hold")
          if (limitedHit) {
            limited.push(chunk.name)
            room = 0
            continue
          }
          taken.push(chunk.name)
        }
      }
      const parts: Array<string> = []
      if (checkedOut.length > 0) {
        parts.push(`Checked out ${checkedOut.join(", ")}.`)
      }
      if (taken.length > 0) {
        parts.push(`${taken.join(", ")} ${taken.length === 1 ? "was" : "were"} already checked out, so ${taken.length === 1 ? "it was" : "they were"} left.`)
      }
      if (limited.length > 0) {
        const cap = project.maxHeldChunks
        parts.push(
          `${limited.join(", ")} would pass the limit of ${cap} ${cap === 1 ? "chunk" : "chunks"} one person may hold.`
        )
      }
      if (parts.length === 0) {
        parts.push("Nothing was checked out.")
      }
      setCheckoutNote(parts.join(" "))
      setSelected((prev) => prev.filter((id) => !checkedIds.includes(id)))
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function fuse() {
    if (!session || !chunks) {
      navigate("/login")
      return
    }
    const chosen = chunks.filter((chunk) => selected.includes(chunk.id))
    if (new Set(chosen.map((chunk) => chunk.binaryId)).size > 1) {
      setActionError("Fuse chunks from one binary.")
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const parent = await api.fuse(
        projectSlug,
        selected,
        fuseName.trim() || undefined,
        session.token
      )
      setSelected([])
      setFuseName("")
      await reload()
      navigate(`/projects/${projectSlug}/chunks/${parent.id}`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Fuse failed")
    } finally {
      setBusy(false)
    }
  }

  const matched = chunks.filter((chunk) => chunk.state === "matched")
  const languageOf = (chunk: ChunkSummary) =>
    chunk.languageOverride === "cpp" || chunk.languageOverride === "c"
      ? chunk.languageOverride
      : project.language === "cpp"
        ? "cpp"
        : "c"
  const linkLanguages = [...new Set(matched.map(languageOf))]
  const activeLinkLanguage = linkLanguages.includes(linkLanguage)
    ? linkLanguage
    : linkLanguages[0] ?? recipeLanguage
  const linkBinaries = [
    ...new Set(
      matched.filter((chunk) => languageOf(chunk) === activeLinkLanguage).map((chunk) => chunk.binaryId)
    )
  ]
  const activeBinary = linkBinaries.includes(linkBinary) ? linkBinary : linkBinaries[0] ?? ""
  const linkCount = matched.filter(
    (chunk) => languageOf(chunk) === activeLinkLanguage && chunk.binaryId === activeBinary
  ).length

  async function saveRecipe() {
    if (!session) {
      navigate("/login")
      return
    }
    const nextFlags = flags.split(/\s+/).filter((flag) => flag.length > 0)
    if (nextFlags.length === 0 || nextFlags.some((flag) => !flag.startsWith("-"))) {
      setActionError("Flags are a space-separated list such as -O2")
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      const updated = await api.updateSettings(
        projectSlug,
        { language: recipeLanguage, flags: nextFlags },
        session.token
      )
      setProject(updated)
      setEvents(await api.projectActivity(projectSlug))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save the compiler recipe")
    } finally {
      setBusy(false)
    }
  }

  async function startLink() {
    if (!session) {
      navigate("/login")
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await api.startIntegration(
        projectSlug,
        {
          ...(activeBinary ? { binaryId: activeBinary } : {}),
          language: activeLinkLanguage
        },
        session.token
      )
      await reload()
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Could not start the integration build"
      )
    } finally {
      setBusy(false)
    }
  }

  const states: Array<ChunkState | "all"> = [
    "all",
    "open",
    "leased",
    "validating",
    "matched",
    "stale",
    "blocked"
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          <Link to="/projects" className="underline underline-offset-2">
            Projects
          </Link>
          <span className="mx-2">/</span>
          <span className="font-mono">{project.slug}</span>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <FollowButton kind="project" id={project.slug} />
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{project.description}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{project.language}</Badge>
          <span>
            {project.toolchain.compiler} {project.toolchain.version}
          </span>
          <span>· lease {project.leaseHours}h</span>
          <span>· max hold {project.maxHoldHours}h</span>
          <span>· {project.maxConcurrentLeases} competing {project.maxConcurrentLeases === 1 ? "lease" : "leases"}</span>
          <span>· hold {project.maxHeldChunks}</span>
          <span>· {project.followerCount} followers</span>
          {typeRevision !== null ? <span>· type rev {typeRevision}</span> : null}
          <Button asChild variant="outline" size="sm">
            <Link to={`/projects/${project.slug}/types`}>Types</Link>
          </Button>
        </div>
      </div>

      {roleReady && canMaintain ? (
        <Card>
          <CardHeader>
            <CardTitle>Import Ghidra export</CardTitle>
            <CardDescription>
              Drop the JSON from ExportReHydra. Each function becomes a chunk on this board.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importFile(file)
              }}
            />
            <button
              type="button"
              disabled={importBusy}
              onClick={() => importInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setImportOver(true)
              }}
              onDragLeave={() => setImportOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setImportOver(false)
                const file = e.dataTransfer.files[0]
                if (file) void importFile(file)
              }}
              className={`flex min-h-28 w-full items-center justify-center rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground ${
                importOver ? "border-primary bg-primary/5" : "border-input bg-muted/30"
              }`}
            >
              {importBusy ? "Importing…" : "Drop the JSON here, or click to choose it."}
            </button>
            {importNote ? <p className="text-sm">{importNote}</p> : null}
            {importError ? (
              <p className="whitespace-pre-line text-sm text-destructive" role="alert">
                {importError}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {states.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setFilter(s)
              setPage(0)
            }}
            className={`rounded-md border px-2.5 py-1 text-xs ${
              filter === s
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {s}
            {s !== "all" ? ` (${project.stats[s]})` : ` (${project.stats.total})`}
          </button>
        ))}
        <ChunkQuery onChange={applyChunkQuery} />
      </div>

      {roleReady && canMaintain ? (
        <Card>
          <CardHeader>
            <CardTitle>Competing leases</CardTitle>
            <CardDescription>
              Default is one exclusive lease. Raise competing leases when several people
              should work the same chunk. Chunks one person may hold is how many functions
              they can check out at once. A match still takes the chunk.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="leaseCap">Max concurrent leases</Label>
              <Input
                id="leaseCap"
                value={leaseCap}
                onChange={(e) => setLeaseCap(e.target.value)}
                inputMode="numeric"
                className="w-24"
              />
            </div>
            <Button onClick={() => void saveLeaseCap()} disabled={busy}>
              Save
            </Button>
            <div className="space-y-2">
              <Label htmlFor="holdCap">Chunks one person may hold</Label>
              <Input
                id="holdCap"
                value={holdCap}
                onChange={(e) => setHoldCap(e.target.value)}
                inputMode="numeric"
                className="w-24"
              />
            </div>
            <Button onClick={() => void saveHoldCap()} disabled={busy}>
              Save
            </Button>
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {roleReady ? (
        <ProjectMembersCard
          key={membersKey}
          projectSlug={projectSlug}
          session={session && user ? { token: session.token, userId: user.id } : null}
          myRole={myRole}
          checkoutPolicy={project.checkoutPolicy}
          onChanged={() => {
            reloadMembership()
            void api.projectActivity(projectSlug).then(setEvents)
          }}
        />
      ) : null}

      {roleReady && canMaintain && session ? (
        <ProjectAccessCard
          project={project}
          token={session.token}
          onProjectChanged={(updated) => {
            setProject(updated)
            setMembersKey((k) => k + 1)
            void api.projectActivity(projectSlug).then(setEvents)
          }}
        />
      ) : null}

      {roleReady && canMaintain ? (
        <Card>
          <CardHeader>
            <CardTitle>Compiler recipe</CardTitle>
            <CardDescription>
              One language per project. C++ uses g++. Changing the language or flags
              rechecks every current match and reopens the ones that miss.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="recipeLanguage">Language</Label>
              <select
                id="recipeLanguage"
                value={recipeLanguage}
                onChange={(e) => setRecipeLanguage(e.target.value === "cpp" ? "cpp" : "c")}
                className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="c">C</option>
                <option value="cpp">C++</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="flags">Flags</Label>
              <Input
                id="flags"
                value={flags}
                onChange={(e) => setFlags(e.target.value)}
                className="w-56"
              />
            </div>
            <Button onClick={() => void saveRecipe()} disabled={busy}>
              Save recipe
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Integration build</CardTitle>
          <CardDescription>
            Links matched functions and compares the bytes at their original addresses.
            A miss reopens that chunk. An isolated match stays the success state until this link disagrees.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {roleReady && canMaintain ? (
            <div className="flex flex-wrap items-end gap-3">
              {linkLanguages.length > 1 ? (
                <div className="space-y-2">
                  <Label htmlFor="linkLanguage">Language</Label>
                  <select
                    id="linkLanguage"
                    value={activeLinkLanguage}
                    onChange={(e) => setLinkLanguage(e.target.value === "cpp" ? "cpp" : "c")}
                    className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    {linkLanguages.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {linkBinaries.length > 1 ? (
                <div className="space-y-2">
                  <Label htmlFor="linkBinary">Binary</Label>
                  <select
                    id="linkBinary"
                    value={activeBinary}
                    onChange={(e) => setLinkBinary(e.target.value)}
                    className="flex h-9 max-w-64 rounded-md border border-input bg-transparent px-3 text-sm"
                  >
                    {linkBinaries.map((id) => (
                      <option key={id} value={id}>
                        {id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <Button onClick={() => void startLink()} disabled={busy || linkCount < 2}>
                Link {linkCount} matched {linkCount === 1 ? "function" : "functions"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Maintainers start a link once at least two functions are matched.
            </p>
          )}
          {integrations.length > 0 ? (
            <div className="space-y-3">
              {integrations.map((integration) => (
                <IntegrationRun
                  key={integration.id}
                  projectSlug={project.slug}
                  integration={integration}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No integration build yet.</p>
          )}
        </CardContent>
      </Card>

      {roleReady && canMaintain ? (
        <Card>
          <CardHeader>
            <CardTitle>Fuse chunks</CardTitle>
            <CardDescription>
              Select two or more open, stale, or matched chunks from one binary. They
              become one lease. A matched member loses its match.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="fuseName">Name</Label>
              <Input
                id="fuseName"
                value={fuseName}
                onChange={(e) => setFuseName(e.target.value)}
                placeholder="optional"
                className="w-56"
              />
            </div>
            <Button onClick={() => void fuse()} disabled={busy || selected.length < 2}>
              Fuse {selected.length} {selected.length === 1 ? "chunk" : "chunks"}
            </Button>
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Chunks</CardTitle>
          <CardDescription>
            {visible.length} shown · you hold {heldIds.size} of {project.maxHeldChunks}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-0">
          <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
            <Button onClick={() => void checkoutSelected()} disabled={busy || checkoutCount === 0}>
              {session ? `Check out ${checkoutCount}` : "Log in to check out"}
            </Button>
            {checkoutNote ? <p className="text-sm text-muted-foreground">{checkoutNote}</p> : null}
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {visible.length === 0
                  ? "0 functions"
                  : `${pageStart + 1}–${pageStart + pageRows.length} of ${visible.length}`}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2 font-medium">Select</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((chunk) => {
                return (
                <tr key={chunk.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${chunk.name}`}
                      checked={selected.includes(chunk.id)}
                      disabled={!selectable(chunk) && !selected.includes(chunk.id)}
                      onChange={() => toggle(chunk)}
                    />
                  </td>
                  <td className="px-4 py-2 font-medium">{chunk.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{chunk.address}</td>
                  <td className="px-4 py-2 font-mono text-xs">{chunk.size}</td>
                  <td className="px-4 py-2">
                    <Badge variant={stateVariant[chunk.state]}>{chunk.state}</Badge>
                    {heldIds.has(chunk.id) ? (
                      <span className="ml-2 text-xs text-muted-foreground">yours</span>
                    ) : null}
                    {chunk.state === "stale" ? (
                      <span className="ml-2 text-xs text-muted-foreground">last match invalidated</span>
                    ) : null}
                    {chunk.matchUsesInlineAsm ? (
                      <Badge variant="outline" className="ml-2" title="This match uses inline assembly">
                        asm
                      </Badge>
                    ) : chunk.allowInlineAsm ? (
                      <span className="ml-2 text-xs text-muted-foreground">asm allowed</span>
                    ) : null}
                    {project.maxConcurrentLeases > 1 && chunk.leaseCount > 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {chunk.leaseCount}/{project.maxConcurrentLeases}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant={canCheckout(chunk, leaseSlots, user?.id) ? "default" : "outline"}
                        onClick={() => setQuery("work", chunk.id)}
                      >
                        Work
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setQuery("attempts", chunk.id)}>
                        Attempts
                      </Button>
                    </div>
                  </td>
                </tr>
                )
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No chunks in this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>

      <ChunkWorkDialog
        open={workId !== null && chunks.some((chunk) => chunk.id === workId)}
        projectSlug={project.slug}
        chunkId={workId ?? ""}
        canMaintain={canMaintain}
        onClose={() => setQuery("work", null)}
        onChanged={() => {
          void reload()
        }}
      />
      <AttemptHistoryDialog
        open={attemptsId !== null && chunks.some((chunk) => chunk.id === attemptsId)}
        projectSlug={project.slug}
        chunkId={attemptsId ?? ""}
        chunkName={chunks.find((chunk) => chunk.id === attemptsId)?.name ?? "Function"}
        onClose={() => setQuery("attempts", null)}
      />

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Checkouts, matches, proposals, and other project events.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityList events={events} />
        </CardContent>
      </Card>
    </div>
  )
}
