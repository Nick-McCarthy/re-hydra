import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
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

export function ProjectPage() {
  const { projectSlug = "" } = useParams()
  const { session, user } = useAuth()
  const { canMaintain, ready: roleReady } = useMembership(projectSlug)
  const navigate = useNavigate()
  const [project, setProject] = React.useState<ProjectSummary | null>(null)
  const [chunks, setChunks] = React.useState<Array<ChunkSummary> | null>(null)
  const [typeRevision, setTypeRevision] = React.useState<number | null>(null)
  const [filter, setFilter] = React.useState<ChunkState | "all">("all")
  const [selected, setSelected] = React.useState<Array<string>>([])
  const [fuseName, setFuseName] = React.useState("")
  const [events, setEvents] = React.useState<Array<ProjectEvent>>([])
  const [leaseCap, setLeaseCap] = React.useState("1")
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
    const [p, c, env, activity, links] = await Promise.all([
      api.getProject(projectSlug),
      api.listChunks(projectSlug),
      api.typeEnvironment(projectSlug).catch(() => null),
      api.projectActivity(projectSlug).catch(() => []),
      api.listIntegrations(projectSlug).catch(() => [])
    ])
    setProject(p)
    setChunks(c)
    setTypeRevision(env?.revision ?? null)
    setEvents(activity)
    setIntegrations(links)
    setLeaseCap(String(p.maxConcurrentLeases))
    setRecipeLanguage(p.language === "cpp" ? "cpp" : "c")
    setFlags(p.toolchain.flags.join(" "))
  }, [projectSlug])

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [p, c, env, activity, links] = await Promise.all([
          api.getProject(projectSlug),
          api.listChunks(projectSlug),
          api.typeEnvironment(projectSlug).catch(() => null),
          api.projectActivity(projectSlug).catch(() => []),
          api.listIntegrations(projectSlug).catch(() => [])
        ])
        if (!cancelled) {
          setProject(p)
          setChunks(c)
          setTypeRevision(env?.revision ?? null)
          setEvents(activity)
          setIntegrations(links)
          setLeaseCap(String(p.maxConcurrentLeases))
          setRecipeLanguage(p.language === "cpp" ? "cpp" : "c")
          setFlags(p.toolchain.flags.join(" "))
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Failed to load project")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectSlug])

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

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }

  if (!project || !chunks) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>
  }

  const selectedBinary = chunks.find((c) => selected.includes(c.id))?.binaryId
  const visible = filter === "all" ? chunks : chunks.filter((c) => c.state === filter)

  function toggle(chunk: ChunkSummary) {
    if (!fuseable.has(chunk.state)) return
    if (selectedBinary && chunk.binaryId !== selectedBinary && !selected.includes(chunk.id)) {
      return
    }
    setSelected((prev) =>
      prev.includes(chunk.id) ? prev.filter((id) => id !== chunk.id) : [...prev, chunk.id]
    )
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
      setEvents(await api.projectActivity(projectSlug))
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save settings")
    } finally {
      setBusy(false)
    }
  }

  async function fuse() {
    if (!session) {
      navigate("/login")
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

      <div className="flex flex-wrap gap-2">
        {states.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
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
      </div>

      {roleReady && canMaintain ? (
        <Card>
          <CardHeader>
            <CardTitle>Competing leases</CardTitle>
            <CardDescription>
              Default is one exclusive lease. Raise this when the project wants several people
              working the same chunk at once. A match still takes the chunk.
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
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          </CardContent>
        </Card>
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
            {visible.length} shown · check out an open chunk, or open its name to review it
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {canMaintain ? <th className="w-10 px-4 py-2 font-medium" /> : null}
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Address</th>
                <th className="px-4 py-2 font-medium">Size</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((chunk) => {
                const canSelect =
                  fuseable.has(chunk.state) &&
                  (selectedBinary === undefined || chunk.binaryId === selectedBinary)
                const checkout = canCheckout(chunk, project.maxConcurrentLeases, user?.id)
                return (
                <tr key={chunk.id} className="border-b last:border-0 hover:bg-muted/30">
                  {canMaintain ? (
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${chunk.name}`}
                        checked={selected.includes(chunk.id)}
                        disabled={!canSelect && !selected.includes(chunk.id)}
                        onChange={() => toggle(chunk)}
                      />
                    </td>
                  ) : null}
                  <td className="px-4 py-2">
                    <Link
                      to={`/projects/${project.slug}/chunks/${chunk.id}`}
                      className="font-medium underline-offset-2 hover:underline"
                    >
                      {chunk.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{chunk.address}</td>
                  <td className="px-4 py-2 font-mono text-xs">{chunk.size}</td>
                  <td className="px-4 py-2">
                    <Badge variant={stateVariant[chunk.state]}>{chunk.state}</Badge>
                    {chunk.state === "stale" ? (
                      <span className="ml-2 text-xs text-muted-foreground">last match invalidated</span>
                    ) : null}
                    {project.maxConcurrentLeases > 1 && chunk.leaseCount > 0 ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {chunk.leaseCount}/{project.maxConcurrentLeases}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant={checkout ? "default" : "outline"} asChild>
                      <Link to={`/projects/${project.slug}/chunks/${chunk.id}`}>
                        {checkout ? "Check out" : "Open"}
                      </Link>
                    </Button>
                  </td>
                </tr>
                )
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={canMaintain ? 6 : 5} className="px-4 py-8 text-center text-muted-foreground">
                    No chunks in this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

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
