import * as React from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"

/** Ask for a reset link. The answer is the same whether or not the email has an account. */
export function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("")
  const [sent, setSent] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.requestPasswordReset(email.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the reset link")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          We email a link that lets you choose a new password. It works once, for an hour.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>The address you sign in with.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm">
              If an account uses <span className="font-medium">{email.trim()}</span>, a reset link is on its way.
              Check your inbox and spam folder.
            </p>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void submit(event)}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={busy} className="w-full">
                Send reset link
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link to="/login" className="underline underline-offset-2">
          Sign in
        </Link>
        .
      </p>
    </div>
  )
}
