import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function LoginPage() {
  const { setSession, user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = React.useState("dev@re-hydra.local")
  const [displayName, setDisplayName] = React.useState("")
  const [token, setToken] = React.useState(params.get("token") ?? "")
  const [devToken, setDevToken] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (user) navigate("/projects", { replace: true })
  }, [user, navigate])

  async function requestLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const res = await api.requestMagicLink(email.trim(), displayName.trim() || undefined)
      if (res.devToken) {
        setDevToken(res.devToken)
        setToken(res.devToken)
        setStatus("Dev token ready — paste is optional; click Consume.")
      } else {
        setStatus("Magic link sent (check API console / mailer).")
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  async function consume(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await api.consumeMagicLink(token.trim())
      setSession(session)
      navigate("/projects", { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Invalid or expired token")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Magic-link auth. Locally the API returns a <code className="font-mono">devToken</code>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request link</CardTitle>
          <CardDescription>Email is enough for local seed users.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void requestLink(e)}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="displayName">Display name (optional)</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              Send magic link
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consume token</CardTitle>
          <CardDescription>Creates a bearer session in this browser.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void consume(e)}>
            <div className="space-y-2">
              <Label htmlFor="token">Token</Label>
              <Input
                id="token"
                className="font-mono"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                required
              />
            </div>
            {devToken ? (
              <p className="rounded-md bg-accent/60 px-3 py-2 font-mono text-xs break-all">
                {devToken}
              </p>
            ) : null}
            <Button type="submit" disabled={busy || !token.trim()} className="w-full">
              Consume
            </Button>
          </form>
        </CardContent>
      </Card>

      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <p className="text-sm text-muted-foreground">
        <Link to="/projects" className="underline underline-offset-2">
          Browse projects without signing in
        </Link>
      </p>
    </div>
  )
}
