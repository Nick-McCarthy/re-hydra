import * as React from "react"

const storageKey = "re-hydra-theme"

export type Theme = "light" | "dark"

type ThemeState = {
  theme: Theme
  toggle: () => void
}

const ThemeContext = React.createContext<ThemeState | null>(null)

export function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === "dark" ? "dark" : "light"
  } catch {
    return "light"
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // Private mode can reject storage. The class still applies for this visit.
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>(() => readTheme())

  const toggle = React.useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark"
      applyTheme(next)
      storeTheme(next)
      return next
    })
  }, [])

  const value = React.useMemo(() => ({ theme, toggle }), [theme, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = React.useContext(ThemeContext)
  if (!value) {
    throw new Error("useTheme must be used inside ThemeProvider")
  }
  return value
}
