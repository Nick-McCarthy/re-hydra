import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

/**
 * The page a reset email links to. The token is in the URL fragment
 * (`#token=…`), so it is never sent to a server or kept in a Referer. It is
 * read once and cleared from the address bar.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { setSession } = useAuth()
  const [token] = React.useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"))
  const [password, setPassword] = React.useState("")
  const [again, setAgain] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState(false)

  React.useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!token) return
    if (password !== again) {
      setError("The passwords do not match.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.confirmPasswordReset(token, password)
      // Every session for the account ended, this browser's included.
      setSession(null)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Setting it signs you out everywhere. Sign in again with the new password.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New password</CardTitle>
          <CardDescription>8 to 128 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4">
              <p className="text-sm">Your password is set.</p>
              <Button className="w-full" onClick={() => navigate("/login", { replace: true })}>
                Sign in
              </Button>
            </div>
          ) : !token ? (
            <p className="text-sm">
              This page needs the link from your reset email.{" "}
              <Link to="/forgot-password" className="underline underline-offset-2">
                Ask for a new link
              </Link>
              .
            </p>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void submit(event)}>
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="again">New password again</Label>
                <Input
                  id="again"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={again}
                  onChange={(event) => setAgain(event.target.value)}
                  required
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive">
                  {error}{" "}
                  {/link/.test(error) ? (
                    <Link to="/forgot-password" className="underline underline-offset-2">Ask for a new link</Link>
                  ) : null}
                </p>
              ) : null}
              <Button type="submit" disabled={busy} className="w-full">
                Set password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
