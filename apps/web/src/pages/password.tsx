import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function PasswordPage() {
  const { session, setSession, ready } = useAuth()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (ready && !session) navigate("/login", { replace: true })
  }, [ready, session, navigate])

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
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Changing it signs out every other session for this account.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Use at least 8 characters.</CardDescription>
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

      <p className="text-sm text-muted-foreground">
        <Link to="/projects" className="underline underline-offset-2">
          Back to projects
        </Link>
      </p>
    </div>
  )
}
