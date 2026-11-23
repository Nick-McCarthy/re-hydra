import * as React from "react"
import { api, loadSession, saveSession, type Session, type UserProfile } from "@/lib/api"

type AuthState = {
  session: Session | null
  user: UserProfile | null
  ready: boolean
  setSession: (session: Session | null) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = React.createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = React.useState<Session | null>(null)
  const [ready, setReady] = React.useState(false)

  const setSession = React.useCallback((next: Session | null) => {
    saveSession(next)
    setSessionState(next)
  }, [])

  const refresh = React.useCallback(async () => {
    const stored = loadSession()
    if (!stored) {
      setSessionState(null)
      setReady(true)
      return
    }
    try {
      const user = await api.me(stored.token)
      const next = { ...stored, user }
      saveSession(next)
      setSessionState(next)
    } catch {
      saveSession(null)
      setSessionState(null)
    } finally {
      setReady(true)
    }
  }, [])

  const logout = React.useCallback(async () => {
    const token = loadSession()?.token
    if (token) {
      try {
        await api.logout(token)
      } catch {
        // ignore network/logout failures; clear local session either way
      }
    }
    setSession(null)
  }, [setSession])

  React.useEffect(() => {
    const started = performance.now()
    console.log("[auth] refresh")
    void refresh().then(() => {
      console.log(`[auth] ready ${Math.round(performance.now() - started)}ms`)
    })
  }, [refresh])

  const value = React.useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      ready,
      setSession,
      refresh,
      logout
    }),
    [session, ready, setSession, refresh, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = React.useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
