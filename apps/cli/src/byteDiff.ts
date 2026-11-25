/**
 * Reading a missed attempt's diagnostics. matchd ends a miss with
 *
 *   score=0.91250 equal=73/80 bytes
 *   --- original (masked) ---
 *   55
 *   ??        (a relocated byte, masked on both sides)
 *   ...
 *   --- candidate (masked) ---
 *   ...
 *
 * one byte per line, at most 80 per side. This finds where the two first
 * differ, so a person or an agent can see what to change without reading
 * two columns of hex.
 */

export type ByteDiff = {
  readonly score: number | null
  readonly equalBytes: number | null
  readonly originalBytes: number | null
  /** Bytes in the dump (the first 80 at most). */
  readonly shown: number
  /** Offset of the first differing byte in the dump; null when the dumped bytes agree. */
  readonly firstDifference: number | null
  /** Differing positions among the dumped bytes, counting a length difference. */
  readonly differing: number
  readonly originalLength: number
  readonly candidateLength: number
  /** A few rows of text around the first difference. */
  readonly window: ReadonlyArray<string>
}

const section = (lines: ReadonlyArray<string>, header: string): Array<string> => {
  const start = lines.findIndex((line) => line.trim().startsWith(header))
  if (start < 0) return []
  const out: Array<string> = []
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim()
    if (line.startsWith("---")) break
    if (/^(\?\?|[0-9a-f]{2})$/i.test(line)) out.push(line.toLowerCase())
  }
  return out
}

const hex = (n: number) => `+0x${n.toString(16).padStart(4, "0")}`

/** The byte comparison in a miss, or undefined when the text has none (a compile error, a match). */
export const parseByteDiff = (diagnostics: string | null): ByteDiff | undefined => {
  if (diagnostics === null) return undefined
  const lines = diagnostics.split(/\r?\n/)
  const original = section(lines, "--- original")
  const candidate = section(lines, "--- candidate")
  if (original.length === 0 && candidate.length === 0) return undefined

  const header = /score=([0-9.]+)\s+equal=(\d+)\/(\d+)/.exec(diagnostics)
  const shown = Math.max(original.length, candidate.length)
  let first: number | null = null
  let differing = 0
  for (let i = 0; i < shown; i++) {
    if (original[i] !== candidate[i]) {
      differing++
      if (first === null) first = i
    }
  }

  const window: Array<string> = []
  if (first !== null) {
    const from = Math.max(0, first - 4)
    const to = Math.min(shown, from + 12)
    const cell = (bytes: ReadonlyArray<string>, i: number) => {
      const value = bytes[i] ?? "--"
      return original[i] === candidate[i] ? ` ${value} ` : `[${value}]`
    }
    const row = (label: string, bytes: ReadonlyArray<string>) => {
      const cells: Array<string> = []
      for (let i = from; i < to; i++) cells.push(cell(bytes, i))
      return `${label.padEnd(10)} ${hex(from)}  ${cells.join("")}`
    }
    window.push(row("original", original), row("candidate", candidate))
  }

  return {
    score: header ? Number(header[1]) : null,
    equalBytes: header ? Number(header[2]) : null,
    originalBytes: header ? Number(header[3]) : null,
    shown,
    firstDifference: first,
    differing,
    originalLength: original.length,
    candidateLength: candidate.length,
    window
  }
}

/** Plain-text lines summarizing a diff, for the terminal. */
export const describeByteDiff = (diff: ByteDiff): Array<string> => {
  const lines: Array<string> = []
  if (diff.equalBytes !== null && diff.originalBytes !== null) {
    lines.push(`  equal:    ${diff.equalBytes}/${diff.originalBytes} bytes`)
  }
  if (diff.firstDifference === null) {
    lines.push(
      diff.originalBytes !== null && diff.originalBytes > diff.shown
        ? `  The first ${diff.shown} bytes agree; the difference is further in.`
        : "  The dumped bytes agree."
    )
    return lines
  }
  lines.push(
    `  first difference at ${hex(diff.firstDifference)} (byte ${diff.firstDifference}); ` +
      `${diff.differing} of the first ${diff.shown} bytes differ`
  )
  if (diff.originalLength !== diff.candidateLength) {
    lines.push(
      `  the candidate is ${diff.candidateLength < diff.originalLength ? "shorter" : "longer"}: ` +
        `${diff.candidateLength} bytes against ${diff.originalLength}`
    )
  }
  lines.push(...diff.window.map((line) => `  ${line}`))
  lines.push(
    diff.window.some((line) => line.includes("??"))
      ? "  [..] differs. ?? is a relocated byte (a call or data address), masked on both sides."
      : "  [..] differs; -- is past the end."
  )
  return lines
}
