import * as React from "react"
import { Link } from "react-router-dom"
import { Diagnostics } from "@/components/diagnostics"
import { Dialog } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { api, type AttemptSummary } from "@/lib/api"

export function AttemptHistoryDialog({
  open,
  projectSlug,
  chunkId,
  chunkName,
  onClose
}: {
  open: boolean
  projectSlug: string
  chunkId: string
  chunkName: string
  onClose: () => void
}) {
  const [attempts, setAttempts] = React.useState<Array<AttemptSummary>>([])
  const [openAttemptId, setOpenAttemptId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    const started = performance.now()
    console.log(`[attempts] open ${projectSlug}/${chunkName}`)
    void api.listAttempts(projectSlug, chunkId).then(
      (list) => {
        console.log(`[attempts] list ${Math.round(performance.now() - started)}ms count=${list.length}`)
        if (!cancelled) setAttempts(list)
      },
      (err) => {
        console.log(`[attempts] failed ${Math.round(performance.now() - started)}ms`, err)
        if (!cancelled) setError("Could not load attempts")
      }
    )
    return () => {
      cancelled = true
    }
  }, [open, projectSlug, chunkId])

  return (
    <Dialog open={open} title={`Attempts · ${chunkName}`} onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        Highest score first. The best attempt is what the next lease inherits.
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {attempts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attempts yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">Score</th>
                <th className="px-4 py-2 font-medium">Matched</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <React.Fragment key={attempt.id}>
                  <tr className="border-b align-top last:border-0">
                    <td className="px-4 py-2">
                      <Link to={`/users/${attempt.userId}`} className="underline-offset-2 hover:underline">
                        {attempt.displayName}
                      </Link>
                      {attempt.best ? (
                        <Badge variant="success" className="ml-2">
                          best
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {attempt.score === null ? "—" : attempt.score.toFixed(3)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {attempt.matched === null ? "pending" : String(attempt.matched)}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(attempt.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {attempt.diagnostics ? (
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() =>
                            setOpenAttemptId((current) => (current === attempt.id ? null : attempt.id))
                          }
                        >
                          {openAttemptId === attempt.id ? "Hide" : "Show"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">
                          {attempt.finishedAt ? "—" : "pending"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {openAttemptId === attempt.id && attempt.diagnostics ? (
                    <tr className="border-b last:border-0">
                      <td colSpan={5} className="px-4 py-3">
                        <Diagnostics text={attempt.diagnostics} matched={attempt.matched} />
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  )
}
