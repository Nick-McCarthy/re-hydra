export type ParsedDiagnostics =
  | { kind: "match" }
  | { kind: "compile"; text: string }
  | { kind: "tool"; text: string }
  | {
      kind: "compare"
      scoreLabel: string
      original: Array<string>
      candidate: Array<string>
    }
  | { kind: "plain"; text: string }

const section = (text: string, start: string, end?: string): Array<string> => {
  const from = text.indexOf(start)
  if (from < 0) return []
  const body = text.slice(from + start.length)
  const until = end === undefined ? body.length : body.indexOf(end)
  const slice = until < 0 ? body : body.slice(0, until)
  return slice
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Split matchd's diagnostic text into the pieces the chunk page renders. */
export function parseDiagnostics(text: string): ParsedDiagnostics {
  const trimmed = text.trim()
  if (trimmed === "normalized byte match") {
    return { kind: "match" }
  }
  if (trimmed.startsWith("compile failed:")) {
    return { kind: "compile", text: trimmed.replace(/^compile failed:\s*/, "") }
  }
  if (
    trimmed.startsWith("gcc unavailable:") ||
    trimmed.startsWith("objdump failed:") ||
    trimmed.startsWith("entry symbol") ||
    trimmed.startsWith("matchd error:")
  ) {
    return { kind: "tool", text: trimmed }
  }
  if (trimmed.startsWith("score=")) {
    const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? trimmed
    const masked = trimmed.includes("--- original (masked) ---")
    const originalHeader = masked ? "--- original (masked) ---" : "--- original (canonical) ---"
    const candidateHeader = masked ? "--- candidate (masked) ---" : "--- candidate (canonical) ---"
    return {
      kind: "compare",
      scoreLabel: firstLine,
      original: section(trimmed, originalHeader, candidateHeader),
      candidate: section(trimmed, candidateHeader)
    }
  }
  return { kind: "plain", text: trimmed }
}
