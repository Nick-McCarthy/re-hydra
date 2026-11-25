import { Link, Outlet } from "react-router-dom"
import { AccountMenu } from "@/components/account-menu"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth"
import { useTheme } from "@/lib/theme"

export function AppShell() {
  const { user, ready } = useAuth()
  const { theme, toggle } = useTheme()
  const dark = theme === "dark"

  return (
    <div className="min-h-screen">
      <header className="relative z-20 border-b bg-card/80 backdrop-blur">
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
              Users
            </Link>
            <Link to="/faq" className="text-muted-foreground hover:text-foreground">
              FAQ
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
              <AccountMenu />
            ) : (
              <>
                <Button asChild variant="outline" size="sm">
                  <Link to="/signup">Sign up</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/login">Log in</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-4 px-4 py-6 text-xs text-muted-foreground">
          <Link to="/policy" className="hover:text-foreground">
            Content policy
          </Link>
          <Link to="/faq" className="hover:text-foreground">
            FAQ
          </Link>
          <a
            href="https://github.com/Nick-McCarthy/re-hydra"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            GitHub
          </a>
          {user?.isAdmin ? (
            <Link to="/admin" className="hover:text-foreground">
              Admin
            </Link>
          ) : null}
        </div>
      </footer>
    </div>
  )
}
