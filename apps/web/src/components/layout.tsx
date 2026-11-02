import { Link, Outlet } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { useTheme } from "@/lib/theme"

export function AppShell() {
  const { user, ready, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const dark = theme === "dark"

  return (
    <div className="min-h-screen">
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <Link to="/" className="inline-flex items-center gap-2 font-semibold tracking-tight">
            <img src="/apple-touch-icon.png" alt="" className="size-8 rounded-sm" />
            <span>
              RE-<span className="text-primary">HYDRA</span>
            </span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <Link to="/projects" className="text-muted-foreground hover:text-foreground">
              Projects
            </Link>
            <Link to="/people" className="text-muted-foreground hover:text-foreground">
              People
            </Link>
            <button
              type="button"
              role="switch"
              aria-checked={dark}
              aria-label={dark ? "Dark mode" : "Light mode"}
              onClick={toggle}
              className="inline-flex items-center gap-2 text-xs text-foreground"
            >
              <span
                className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 ${
                  dark ? "border-transparent bg-primary" : "border-input bg-background"
                }`}
              >
                <span
                  className={`size-4 rounded-full bg-foreground transition-transform ${
                    dark ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
              {dark ? "Dark" : "Light"}
            </button>
            {!ready ? null : user ? (
              <>
                <Link
                  to={`/users/${user.id}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {user.displayName || user.email}
                </Link>
                <Button variant="outline" size="sm" onClick={() => void logout()}>
                  Log out
                </Button>
              </>
            ) : (
              <Button asChild size="sm">
                <Link to="/login">Log in</Link>
              </Button>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
