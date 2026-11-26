import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, type UserProjectRef } from "@/lib/api"
import { useAuth } from "@/lib/auth"

/** Display name, password, and account deletion (foundations plan 3). */
export function AccountPage() {
  const { session, ready } = useAuth()
  const navigate = useNavigate()
  const [deleted, setDeleted] = React.useState<ReadonlyArray<{ slug: string; name: string }> | null>(null)

  React.useEffect(() => {
    if (ready && !session && deleted === null) navigate("/login", { replace: true })
  }, [ready, session, deleted, navigate])

  if (deleted !== null) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Account deleted</h1>
        <p className="text-sm text-muted-foreground">
          Your account is gone. Your matches, attempts, and posts stay on the site as from a deleted account.
        </p>
        {deleted.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Archived: {deleted.map((p) => p.name).join(", ")}.
          </p>
        ) : null}
        <p className="text-sm">
          <Link to="/" className="underline underline-offset-2">
            Home
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your display name, password, and account.</p>
      </div>
      <DisplayNameCard />
      <PasswordCard />
      <DeleteAccountCard onDeleted={setDeleted} />
      <p className="text-sm text-muted-foreground">
        <Link to="/projects" className="underline underline-offset-2">
          Back to projects
        </Link>
      </p>
    </div>
  )
}

function DisplayNameCard() {
  const { session, setSession } = useAuth()
  const [displayName, setDisplayName] = React.useState(session?.user.displayName ?? "")
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (session) setDisplayName(session.user.displayName)
  }, [session?.user.displayName]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!session) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const user = await api.updateMe(session.token, displayName.trim())
      setSession({ ...session, user })
      setStatus("Saved. Your matches, attempts, and posts show the new name.")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the display name")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display name</CardTitle>
        <CardDescription>Shown on your profile, your matches, and your posts.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => void save(event)}>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              maxLength={80}
            />
          </div>
          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            type="submit"
            disabled={busy || !session || displayName.trim().length === 0 || displayName.trim() === session.user.displayName}
          >
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordCard() {
  const { session, setSession } = useAuth()
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    if (!session) return
    if (newPassword !== confirm) {
      setError("Those passwords do not match.")
      setStatus(null)
      return
    }
    if (newPassword.length < 8) {
      setError("Use at least 8 characters.")
      setStatus(null)
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const next = await api.changePassword(session.token, currentPassword, newPassword)
      setSession(next)
      setCurrentPassword("")
      setNewPassword("")
      setConfirm("")
      setStatus(
        "Password updated. Other sessions for this account were signed out. Profile tokens still work."
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Use at least 8 characters. Changing it signs out every other session.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => void changePassword(event)}>
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={8}
              maxLength={128}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
              minLength={8}
              maxLength={128}
            />
          </div>
          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={busy || !session} className="w-full">
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function DeleteAccountCard({ onDeleted }: { onDeleted: (archived: ReadonlyArray<{ slug: string; name: string }>) => void }) {
  const { session, setSession } = useAuth()
  const [owned, setOwned] = React.useState<ReadonlyArray<UserProjectRef>>([])
  const [password, setPassword] = React.useState("")
  const [archive, setArchive] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const userId = session?.user.id

  React.useEffect(() => {
    if (!userId) return
    let cancelled = false
    void api.userProjects(userId).then(
      (projects) => {
        if (!cancelled) setOwned(projects.filter((p) => p.role === "owner"))
      },
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [userId])

  async function remove(event: React.FormEvent) {
    event.preventDefault()
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.deleteAccount(session.token, password, archive)
      // Every session and token for the account is gone with it.
      setSession(null)
      onDeleted(result.archivedProjects)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete the account")
    } finally {
      setBusy(false)
    }
  }

  const blocked = owned.length > 0 && !archive

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          This cannot be undone. Your email, password, sessions, tokens, follows, and memberships are deleted. Your
          matches, attempts, and posts stay, shown as from a deleted account, because submitted source is released
          under CC0. If you have strikes, they are kept against a hash of your email.{" "}
          <Link to="/privacy" className="underline underline-offset-2">
            Privacy policy
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={(event) => void remove(event)}>
          {owned.length > 0 ? (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                You own {owned.length === 1 ? "a project" : `${owned.length} projects`}. Offer ownership to someone from
                the project&apos;s Members card, or archive {owned.length === 1 ? "it" : "them"} as part of deleting.
              </p>
              <ul className="list-disc pl-5">
                {owned.map((p) => (
                  <li key={p.slug}>
                    <Link to={`/projects/${p.slug}`} className="underline underline-offset-2">
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={archive}
                  onChange={(event) => setArchive(event.target.checked)}
                />
                <span>
                  Archive {owned.length === 1 ? "it" : "them"} when I delete my account. Archived projects stay readable
                  but nobody can work on them.
                </span>
              </label>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="deletePassword">Password</Label>
            <Input
              id="deletePassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I understand this deletes my account for good.</span>
          </label>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button
            type="submit"
            variant="destructive"
            disabled={busy || !session || password.length === 0 || !confirmed || blocked}
            className="w-full"
          >
            Delete my account
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
