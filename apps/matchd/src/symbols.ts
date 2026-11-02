type NmRow = {
  readonly addr: string
  readonly size: number | undefined
  readonly kind: string
  readonly name: string
}

const SIZED_NM = /^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([A-Za-z])\s+(.+)$/
const PLAIN_NM = /^([0-9a-fA-F]+)?\s+([A-Za-z])\s+(.+)$/

const parseNm = (dump: string): Array<NmRow> => {
  const rows: Array<NmRow> = []
  for (const line of dump.split(/\r?\n/)) {
    const sized = SIZED_NM.exec(line.trim())
    if (sized !== null && sized[3] !== undefined && sized[4] !== undefined) {
      if (sized[3] !== "T" && sized[3] !== "t") continue
      const size = Number.parseInt(sized[2] ?? "", 16)
      rows.push({
        addr: sized[1] ?? "",
        size: Number.isFinite(size) ? size : undefined,
        kind: sized[3],
        name: sized[4].trim()
      })
      continue
    }
    const match = PLAIN_NM.exec(line.trim())
    if (match === null || match[2] === undefined || match[3] === undefined) {
      continue
    }
    if (match[2] !== "T" && match[2] !== "t") continue
    rows.push({
      addr: match[1] ?? "",
      size: undefined,
      kind: match[2],
      name: match[3].trim()
    })
  }
  return rows
}

/** Byte length of one text symbol from `nm -S`. */
export const symbolSize = (nmDump: string, name: string): number | undefined => {
  const hits = parseNm(nmDump).filter((row) => row.name === name || row.name === `_${name}`)
  if (hits.length !== 1) return undefined
  return hits[0]?.size
}

const baseName = (demangled: string): string => demangled.replace(/\(.*$/, "").trim()

/**
 * Pick the object-file symbol for a chunk name.
 * C symbols match directly. C++ symbols may be Itanium-mangled; `nm -C`
 * output is paired with plain `nm` by line order.
 */
export const resolveEntrySymbol = (
  mangledNm: string,
  demangledNm: string,
  entry: string
): string | undefined => {
  const mangled = parseNm(mangledNm)
  const demangled = parseNm(demangledNm)
  const pairs = mangled.map((row, index) => ({
    mangled: row.name,
    demangled: demangled[index]?.name ?? row.name
  }))

  const hits = pairs.filter((pair) =>
    pair.mangled === entry ||
    pair.mangled === `_${entry}` ||
    pair.demangled === entry ||
    baseName(pair.demangled) === entry
  )
  if (hits.length === 0) return undefined
  const exact = hits.find((pair) => pair.mangled === entry || pair.mangled === `_${entry}`)
  if (exact !== undefined) return exact.mangled
  if (hits.length === 1) return hits[0]?.mangled
  return undefined
}

export const safeSymbol = (symbol: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)
