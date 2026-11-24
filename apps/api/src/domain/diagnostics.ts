/**
 * Compile and link diagnostics can quote the original program's bytes:
 *
 * - a missed attempt ends with "--- original (masked) ---" and a byte dump
 *   of the whole function, then the candidate's;
 * - an integration mismatch has "original …" and "linked …" hex lines
 *   around the first differing byte.
 *
 * Those bytes go only to people who already receive them in a work bundle
 * or run the project. Everyone else gets the rest of the text (scores,
 * compiler errors, call-target reasons) with the byte lines removed.
 */
export const BYTES_HIDDEN_NOTE =
  "(Byte comparison hidden. The submitter, the chunk's current holder, and project maintainers can see it.)"

export const hideBytes = (text: string | null): string | null => {
  if (text === null) return null
  const lines = text.split("\n")
  const kept: Array<string> = []
  let hid = false
  for (const line of lines) {
    if (line === "--- original (masked) ---") {
      hid = true
      break
    }
    if (/^(original|linked)\s+[0-9a-f]{2}(\s|$)/i.test(line)) {
      hid = true
      continue
    }
    kept.push(line)
  }
  if (!hid) return text
  return [...kept, BYTES_HIDDEN_NOTE].join("\n")
}
