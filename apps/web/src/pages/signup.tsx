import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function SignupPage() {
  const { setSession, user } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")
  const [acceptPolicy, setAcceptPolicy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (user) navigate("/projects", { replace: true })
  }, [user, navigate])

  async function signUp(event: React.FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError("Those passwords do not match.")
      return
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.")
      return
    }
    if (!acceptPolicy) {
      setError("Agree to the content policy to create an account.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await api.signUp(email.trim(), displayName.trim(), password, acceptPolicy)
      setSession(session)
      navigate("/projects", { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The display name is what other people see on the board.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sign up</CardTitle>
          <CardDescription>Password must be at least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void signUp(event)}>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                maxLength={80}
              />
            </div>
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
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                maxLength={128}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm password</Label>
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
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={acceptPolicy}
                onChange={(event) => setAcceptPolicy(event.target.checked)}
              />
              <span>
                I agree to the{" "}
                <Link to="/policy" target="_blank" className="underline underline-offset-2">
                  content policy
                </Link>
                : no distributed programs, leaked material, or malware.
              </span>
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy || !acceptPolicy} className="w-full">
              Create account
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="underline underline-offset-2">
          Sign in
        </Link>
        .
      </p>
    </div>
  )
}
