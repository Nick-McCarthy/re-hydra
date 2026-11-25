import * as React from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, api, type ReportReason, type ReportTarget } from "@/lib/api"
import { useAuth } from "@/lib/auth"

const reasons: ReadonlyArray<{ value: ReportReason; label: string; hint: string }> = [
  { value: "copyright", label: "Copyright", hint: "Leaked material, a distributed program, or something you hold rights in." },
  { value: "malware", label: "Malware", hint: "The program is malware, or this helps build or deploy it. Do not run it to check." },
  { value: "abuse", label: "Abuse", hint: "Harassment, spam, cheating or piracy help." },
  { value: "other", label: "Something else", hint: "Anything else that breaks the content policy." }
]

/**
 * Sends a report to the site admins. Shown only to signed-in users; the
 * reporter's name is visible to admins, not to the people reported.
 */
export function ReportButton({
  target,
  what,
  size = "sm",
  variant = "ghost"
}: {
  target: ReportTarget
  /** "this project", "this function", "this post" */
  what: string
  size?: "sm" | "default"
  /** text: a small underlined link, for inline post actions. */
  variant?: "ghost" | "outline" | "text"
}) {
  const { session } = useAuth()
  const token = session?.token ?? null
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState<ReportReason | null>(null)
  const [body, setBody] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [sent, setSent] = React.useState(false)

  if (!token) return null

  const close = () => {
    setOpen(false)
    setReason(null)
    setBody("")
    setError(null)
    setSent(false)
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!token || reason === null || body.trim() === "") return
    setBusy(true)
    setError(null)
    try {
      await api.report(target, reason, body.trim(), token)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send the report")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {variant === "text" ? (
        <button type="button" className="text-xs underline underline-offset-2" onClick={() => setOpen(true)}>
          Report
        </button>
      ) : (
        <Button type="button" size={size} variant={variant} onClick={() => setOpen(true)}>
          Report
        </Button>
      )}
      <Dialog open={open} title={`Report ${what}`} onClose={close} size="md">
        {sent ? (
          <div className="space-y-4 text-sm">
            <p>Thanks. The site admins will look at it.</p>
            <Button type="button" onClick={close}>
              Done
            </Button>
          </div>
        ) : (
          <form className="space-y-4 text-sm" onSubmit={(event) => void send(event)}>
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium">What is wrong?</legend>
              {reasons.map((r) => (
                <label key={r.value} className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="reason"
                    className="mt-1"
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  <span>
                    <span className="font-medium">{r.label}.</span>{" "}
                    <span className="text-muted-foreground">{r.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="report-body">Details</Label>
              <Textarea
                id="report-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={2000}
                required
                placeholder="What you found and where."
              />
              {reason === "copyright" ? (
                <p className="text-muted-foreground">
                  A formal copyright notice goes to the address in the{" "}
                  <Link to="/policy#3" className="underline underline-offset-2" onClick={close}>
                    content policy
                  </Link>
                  . A report here still gets the material looked at.
                </p>
              ) : null}
            </div>
            {error ? <p className="text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy || reason === null || body.trim() === ""}>
              Send report
            </Button>
          </form>
        )}
      </Dialog>
    </>
  )
}
