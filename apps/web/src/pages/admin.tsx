import * as React from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  api,
  type AdminProject,
  type AdminReport,
  type AdminUser,
  type ModerationAction,
  type ModerationActionKind,
  type Strike
} from "@/lib/api"
import { useAuth } from "@/lib/auth"

type Tab = "reports" | "projects" | "users" | "log"

const when = (iso: string) => new Date(iso).toLocaleString()
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

const actionLabels: Record<ModerationActionKind, string> = {
  archive_project: "Archived project",
  restore_project: "Restored project",
  remove_post: "Removed post",
  suspend_user: "Suspended account",
  restore_user: "Restored account",
  resolve_report: "Resolved report",
  grant_admin: "Granted admin",
  revoke_admin: "Revoked admin",
  add_strike: "Gave a strike",
  reverse_strike: "Reversed a strike"
}

/**
 * A button that asks for the note every moderation action needs, then runs
 * the action. The note goes in the record.
 */
function NoteAction({
  label,
  title,
  noteLabel = "Why (kept in the record)",
  destructive = false,
  disabled = false,
  run
}: {
  label: string
  title: string
  noteLabel?: string
  destructive?: boolean
  disabled?: boolean
  run: (note: string) => Promise<unknown>
}) {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const close = () => {
    setOpen(false)
    setNote("")
    setError(null)
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await run(note.trim())
      close()
    } catch (err) {
      setError(errorText(err, "That did not work"))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={destructive ? "destructive" : "outline"}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} title={title} onClose={close} size="md">
        <form className="space-y-3 text-sm" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2">
            <Label htmlFor="moderation-note">{noteLabel}</Label>
            <Textarea
              id="moderation-note"
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              autoFocus
            />
          </div>
          {error ? <p className="text-destructive">{error}</p> : null}
          <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={busy || note.trim() === ""}>
            {label}
          </Button>
        </form>
      </Dialog>
    </>
  )
}

function ReportsTab({ token }: { token: string }) {
  const [status, setStatus] = React.useState<"open" | "resolved">("open")
  const [reports, setReports] = React.useState<Array<AdminReport> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const load = React.useCallback(() => {
    api.adminReports(status, token).then(
      (rows) => {
        setReports(rows)
        setError(null)
      },
      (err: unknown) => setError(errorText(err, "Could not load reports"))
    )
  }, [status, token])
  React.useEffect(load, [load])

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["open", "resolved"] as const).map((s) => (
          <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {s === "open" ? "Open" : "Resolved"}
          </Button>
        ))}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {reports === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">{status === "open" ? "No open reports." : "No resolved reports."}</p>
      ) : (
        reports.map((report) => (
          <Card key={report.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <Badge variant={report.reason === "malware" || report.reason === "copyright" ? "warning" : "secondary"}>
                  {report.reason}
                </Badge>
                {report.project.archived ? (
                  <span>{report.project.name}</span>
                ) : (
                  <Link to={`/projects/${report.project.slug}`} className="underline underline-offset-2">
                    {report.project.name}
                  </Link>
                )}
                {report.project.archived ? <Badge variant="outline">archived</Badge> : null}
                {report.chunk ? <span className="font-mono text-sm">· {report.chunk.name}</span> : null}
              </CardTitle>
              <CardDescription>
                {report.reporter ? (
                  <Link to={`/users/${report.reporter.id}`} className="underline underline-offset-2">
                    {report.reporter.displayName}
                  </Link>
                ) : (
                  "a removed user"
                )}{" "}
                · {when(report.createdAt)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap">{report.body}</p>
              {report.post ? (
                <blockquote className="border-l-2 pl-3 text-muted-foreground">
                  <p className="text-xs">
                    Post by {report.post.author?.displayName ?? "a removed user"}
                    {report.post.removed ? " (removed)" : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{report.post.excerpt}</p>
                </blockquote>
              ) : null}
              {report.resolvedAt ? (
                <p className="text-muted-foreground">
                  Resolved by {report.resolvedBy?.displayName ?? "a removed user"} · {when(report.resolvedAt)}:{" "}
                  {report.resolution}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {report.post && !report.post.removed ? (
                    <NoteAction
                      label="Remove post"
                      title="Remove this post"
                      destructive
                      run={(note) => api.adminRemovePost(report.post!.id, note, token).then(load)}
                    />
                  ) : null}
                  {!report.project.archived ? (
                    <NoteAction
                      label="Archive project"
                      title={`Archive ${report.project.name}`}
                      destructive
                      run={(note) => api.adminSetProjectArchived(report.project.slug, true, note, token).then(load)}
                    />
                  ) : null}
                  <NoteAction
                    label="Resolve"
                    title="Resolve this report"
                    noteLabel="What was done (kept in the record)"
                    run={(note) => api.adminResolveReport(report.id, note, token).then(load)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  )
}

function useSearch<T>(search: (q: string) => Promise<Array<T>>) {
  const [q, setQ] = React.useState("")
  const [rows, setRows] = React.useState<Array<T> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const load = React.useCallback(
    (query: string) =>
      search(query).then(
        (next) => {
          setRows(next)
          setError(null)
        },
        (err: unknown) => setError(errorText(err, "Search failed"))
      ),
    [search]
  )
  React.useEffect(() => {
    void load("")
  }, [load])
  return { q, setQ, rows, error, reload: () => load(q), submit: () => void load(q) }
}

function SearchBox({ id, label, value, onChange, onSubmit }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="flex max-w-md items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="flex-1 space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  )
}

function ProjectsTab({ token }: { token: string }) {
  const search = React.useCallback((q: string) => api.adminProjects(q, token), [token])
  const { q, setQ, rows, error, reload, submit } = useSearch<AdminProject>(search)
  return (
    <div className="space-y-4">
      <SearchBox id="admin-project-q" label="Name or slug" value={q} onChange={setQ} onSubmit={submit} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Open reports</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((project) => (
              <tr key={project.id} className="border-t">
                <td className="px-3 py-2">
                  {project.archivedAt ? (
                    project.name
                  ) : (
                    <Link to={`/projects/${project.slug}`} className="underline underline-offset-2">
                      {project.name}
                    </Link>
                  )}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{project.slug}</span>
                </td>
                <td className="px-3 py-2">{project.ownerName ?? "—"}</td>
                <td className="px-3 py-2">{project.openReports}</td>
                <td className="px-3 py-2">
                  {project.archivedAt ? <Badge variant="outline">archived {when(project.archivedAt)}</Badge> : "live"}
                </td>
                <td className="px-3 py-2 text-right">
                  {project.archivedAt ? (
                    <NoteAction
                      label="Restore"
                      title={`Restore ${project.name}`}
                      run={(note) => api.adminSetProjectArchived(project.slug, false, note, token).then(reload)}
                    />
                  ) : (
                    <NoteAction
                      label="Archive"
                      title={`Archive ${project.name}`}
                      destructive
                      run={(note) => api.adminSetProjectArchived(project.slug, true, note, token).then(reload)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * An account's strikes under the repeat-infringer rule (content policy 2.5
 * and 3): add one, or reverse one after a counter-notice or a mistake.
 */
function StrikesButton({ account, token, selfId, onChange }: {
  account: AdminUser
  token: string
  selfId: string
  onChange: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [strikes, setStrikes] = React.useState<Array<Strike> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const load = React.useCallback(() => {
    api.adminStrikes(account.id, token).then(setStrikes, (err: unknown) => setError(errorText(err, "Could not load strikes")))
  }, [account.id, token])
  React.useEffect(() => {
    if (open) load()
  }, [open, load])
  const changed = () => {
    load()
    onChange()
  }
  return (
    <>
      <button type="button" className="underline underline-offset-2" onClick={() => setOpen(true)}>
        {account.activeStrikes} of 3
      </button>
      {account.atStrikeLimit ? (
        <Badge variant="warning" className="ml-2">
          at the limit
        </Badge>
      ) : null}
      <Dialog open={open} title={`Strikes: ${account.displayName}`} onClose={() => setOpen(false)} size="md">
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            A strike counts for 12 months unless it is reversed. At 3, the policy says close the account: suspend it
            once any counter-notice has been handled.
          </p>
          {error ? <p className="text-destructive">{error}</p> : null}
          {strikes === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : strikes.length === 0 ? (
            <p className="text-muted-foreground">No strikes.</p>
          ) : (
            <ul className="space-y-3">
              {strikes.map((strike) => (
                <li key={strike.id} className="space-y-1 rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    {when(strike.createdAt)} by {strike.admin?.displayName ?? "a removed admin"}
                    {strike.active ? null : strike.reversedAt ? " · reversed" : " · expired"}
                  </p>
                  <p className="whitespace-pre-wrap">{strike.note}</p>
                  {strike.reversedAt ? (
                    <p className="text-xs text-muted-foreground">
                      Reversed {when(strike.reversedAt)} by {strike.reversedBy?.displayName ?? "a removed admin"}:{" "}
                      {strike.reversalNote}
                    </p>
                  ) : !strike.active ? null : (
                    <NoteAction
                      label="Reverse"
                      title="Reverse this strike"
                      noteLabel="Why (a counter-notice, a mistake; kept in the record)"
                      run={(note) => api.adminReverseStrike(strike.id, note, token).then(changed)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {account.id === selfId ? null : (
            <NoteAction
              label="Add strike"
              title={`Add a strike to ${account.displayName}`}
              noteLabel="What it is for: the notice or the material, with links (kept in the record)"
              destructive
              run={(note) => api.adminAddStrike(account.id, note, token).then(changed)}
            />
          )}
        </div>
      </Dialog>
    </>
  )
}

function UsersTab({ token, selfId }: { token: string; selfId: string }) {
  const search = React.useCallback((q: string) => api.adminUsers(q, token), [token])
  const { q, setQ, rows, error, reload, submit } = useSearch<AdminUser>(search)
  return (
    <div className="space-y-4">
      <SearchBox id="admin-user-q" label="Email or display name" value={q} onChange={setQ} onSubmit={submit} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Joined</th>
              <th className="px-3 py-2 font-medium">Strikes</th>
              <th className="px-3 py-2 font-medium">State</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((account) => (
              <tr key={account.id} className="border-t align-top">
                <td className="px-3 py-2">
                  <Link to={`/users/${account.id}`} className="underline underline-offset-2">
                    {account.displayName}
                  </Link>
                  {account.isAdmin ? <Badge variant="secondary" className="ml-2">admin</Badge> : null}
                  <div className="text-xs text-muted-foreground">{account.email}</div>
                </td>
                <td className="px-3 py-2">{new Date(account.createdAt).toLocaleDateString()}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <StrikesButton account={account} token={token} selfId={selfId} onChange={() => void reload()} />
                </td>
                <td className="px-3 py-2">
                  {account.suspendedAt ? (
                    <>
                      <Badge variant="warning">suspended {when(account.suspendedAt)}</Badge>
                      {account.suspendedReason ? (
                        <div className="mt-1 text-xs text-muted-foreground">{account.suspendedReason}</div>
                      ) : null}
                    </>
                  ) : (
                    "active"
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {account.suspendedAt ? (
                    <NoteAction
                      label="Restore"
                      title={`Restore ${account.displayName}`}
                      run={(note) => api.adminSetUserSuspended(account.id, false, note, token).then(reload)}
                    />
                  ) : account.isAdmin || account.id === selfId ? null : (
                    <NoteAction
                      label="Suspend"
                      title={`Suspend ${account.displayName}`}
                      noteLabel="Why (kept in the record, and shown to admins)"
                      destructive
                      run={(note) => api.adminSetUserSuspended(account.id, true, note, token).then(reload)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Suspending signs the account out everywhere and revokes its access tokens. Admins are granted and revoked
        from the command line (<code>npm run api:admin</code>), not here.
      </p>
    </div>
  )
}

function LogTab({ token }: { token: string }) {
  const [rows, setRows] = React.useState<Array<ModerationAction> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    api.adminActions(token).then(setRows, (err: unknown) => setError(errorText(err, "Could not load the record")))
  }, [token])
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (rows === null) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing yet.</p>
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Who</th>
            <th className="px-3 py-2 font-medium">What</th>
            <th className="px-3 py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((action) => (
            <tr key={action.id} className="border-t align-top">
              <td className="whitespace-nowrap px-3 py-2">{when(action.createdAt)}</td>
              <td className="px-3 py-2">{action.admin?.displayName ?? "command line"}</td>
              <td className="px-3 py-2">
                {actionLabels[action.kind]}
                {action.project ? <> · {action.project.name}</> : null}
                {action.user ? <> · {action.user.displayName}</> : null}
              </td>
              <td className="whitespace-pre-wrap px-3 py-2">{action.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AdminPage() {
  const { session, user, ready } = useAuth()
  const [tab, setTab] = React.useState<Tab>("reports")
  if (!ready) return null
  if (!session || !user?.isAdmin) {
    return <p className="text-sm text-muted-foreground">This page is for site admins.</p>
  }
  const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
    { id: "reports", label: "Reports" },
    { id: "projects", label: "Projects" },
    { id: "users", label: "Users" },
    { id: "log", label: "Record" }
  ]
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Act on reports and notices under the{" "}
          <Link to="/policy" className="underline underline-offset-2">
            content policy
          </Link>
          . Every action needs a note and goes in the record.
        </p>
      </div>
      <div className="flex gap-2 border-b pb-2">
        {tabs.map((t) => (
          <Button key={t.id} size="sm" variant={tab === t.id ? "default" : "ghost"} onClick={() => setTab(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>
      {tab === "reports" ? <ReportsTab token={session.token} /> : null}
      {tab === "projects" ? <ProjectsTab token={session.token} /> : null}
      {tab === "users" ? <UsersTab token={session.token} selfId={user.id} /> : null}
      {tab === "log" ? <LogTab token={session.token} /> : null}
    </div>
  )
}
