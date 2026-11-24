import { CircleUser } from "lucide-react"
import * as React from "react"
import { Link, useLocation } from "react-router-dom"
import { useAuth } from "@/lib/auth"

export function AccountMenu() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [open, setOpen] = React.useState(false)
  const root = React.useRef<HTMLDivElement>(null)
  const label = user?.displayName || user?.email || "Account"

  React.useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  React.useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (!user) return null

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account, ${label}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <CircleUser className="size-5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-52 overflow-hidden rounded-md border bg-popover py-1 text-sm text-popover-foreground shadow-md"
        >
          <Link
            role="menuitem"
            to={`/users/${user.id}`}
            className="block px-3 py-2 hover:bg-accent"
          >
            Profile
          </Link>
          <Link role="menuitem" to="/account/password" className="block px-3 py-2 hover:bg-accent">
            Password
          </Link>
          <button
            type="button"
            role="menuitem"
            className="block w-full border-t px-3 py-2 text-left hover:bg-accent"
            onClick={() => {
              setOpen(false)
              void logout()
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  )
}
