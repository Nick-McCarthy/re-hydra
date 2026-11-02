import { Badge } from "@/components/ui/badge"
import { parseDiagnostics } from "@/lib/diagnostics"

function InstructionColumns({
  original,
  candidate
}: {
  original: Array<string>
  candidate: Array<string>
}) {
  const rows = Math.max(original.length, candidate.length)
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {(["Original", "Candidate"] as const).map((title) => {
        const lines = title === "Original" ? original : candidate
        const other = title === "Original" ? candidate : original
        return (
          <div key={title} className="overflow-hidden rounded-md border">
            <p className="border-b bg-muted/40 px-2 py-1 text-xs font-medium text-muted-foreground">
              {title}
            </p>
            <ol className="font-mono max-h-72 overflow-auto text-xs">
              {Array.from({ length: rows }, (_, index) => {
                const line = lines[index]
                const differs = line !== other[index]
                return (
                  <li
                    key={index}
                    className={`px-2 py-0.5 ${differs ? "bg-destructive/10" : ""}`}
                  >
                    {line ?? ""}
                  </li>
                )
              })}
            </ol>
          </div>
        )
      })}
    </div>
  )
}

export function Diagnostics({
  text,
  matched,
  pending
}: {
  text: string | null
  matched: boolean | null
  pending?: boolean
}) {
  if (pending || matched === null) {
    return <p className="text-sm text-muted-foreground">Match is running…</p>
  }
  if (matched || text === "normalized byte match") {
    return (
      <p className="text-sm">
        <Badge variant="success">matched</Badge>
        <span className="ml-2 text-muted-foreground">Masked bytes are identical.</span>
      </p>
    )
  }
  if (!text) {
    return <p className="text-sm text-muted-foreground">No diagnostics.</p>
  }

  const parsed = parseDiagnostics(text)
  if (parsed.kind === "match") {
    return (
      <p className="text-sm">
        <Badge variant="success">matched</Badge>
      </p>
    )
  }
  if (parsed.kind === "compile") {
    return (
      <div className="space-y-2">
        <Badge variant="warning">compile failed</Badge>
        <pre className="font-mono max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
          {parsed.text || "(no compiler output)"}
        </pre>
      </div>
    )
  }
  if (parsed.kind === "compare") {
    return (
      <div className="space-y-2">
        <p className="font-mono text-xs text-muted-foreground">{parsed.scoreLabel}</p>
        <p className="text-xs text-muted-foreground">
          Bytes that differ are highlighted. A relocation is ??. A match needs the same length and the same remaining bytes.
        </p>
        <InstructionColumns original={parsed.original} candidate={parsed.candidate} />
      </div>
    )
  }
  return (
    <pre className="font-mono max-h-72 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
      {parsed.text}
    </pre>
  )
}
