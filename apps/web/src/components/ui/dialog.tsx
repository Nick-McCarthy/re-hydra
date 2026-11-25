import * as React from "react"
import { Button } from "@/components/ui/button"

export function Dialog({
  open,
  title,
  onClose,
  children,
  size = "lg"
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  /** md for short forms, lg (default) for work views. */
  size?: "md" | "lg"
}) {
  React.useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-4 w-full ${size === "md" ? "max-w-lg" : "max-w-5xl"} rounded-lg border bg-background p-6 shadow-lg`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
