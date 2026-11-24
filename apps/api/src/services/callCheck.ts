/**
 * Audit A-007. matchd reports, for each relocated field, the symbol the
 * candidate uses and the address the original uses (decoded from its linked
 * bytes). This compares them against the functions imported for the binary.
 *
 * A reference is wrong when:
 * 1. the original's target is a known function and the candidate names a
 *    different known function (`call foo` where the original calls `bar`);
 * 2. the original's target is a known function and the candidate names some
 *    other plain C function (`call printf` where the original calls `bar`);
 * 3. the original's target is not a known function, but the candidate names
 *    one (it calls into the project where the original goes elsewhere).
 *
 * Names are compared with the decorations objdump adds: a leading `_` (i386
 * COFF) or `.` (PowerPC64 ELFv1). Names that are not plain C identifiers
 * (C++ mangling, MSVC decoration) are only checked against known functions,
 * so mangling never causes a false refusal.
 */

export type Reference = {
  readonly offset: number
  readonly type: string
  readonly symbol: string
  readonly originalTarget: string
}

export type KnownFunction = { readonly name: string; readonly address: bigint }

/** A C name. Itanium-mangled C++ names (`_Z…`, `__Z…`) look like identifiers but are not. */
const plainC = /^[A-Za-z_][A-Za-z0-9_]*$/
const itaniumMangled = /^_{1,2}Z/
const plainIdentifier = { test: (name: string) => plainC.test(name) && !itaniumMangled.test(name) }

export const nameVariants = (symbol: string): ReadonlyArray<string> => {
  const variants = new Set([symbol])
  if (symbol.startsWith("_")) variants.add(symbol.slice(1))
  if (symbol.startsWith(".")) variants.add(symbol.slice(1))
  return [...variants]
}

const sameName = (a: string, b: string): boolean =>
  nameVariants(a).some((x) => nameVariants(b).includes(x))

const hex = (value: bigint) => `0x${value.toString(16)}`

export const findReferenceMismatch = (
  references: ReadonlyArray<Reference>,
  known: ReadonlyArray<KnownFunction>
): string | undefined => {
  const byAddress = new Map(known.map((f) => [f.address, f]))
  const byName = new Map<string, KnownFunction>()
  for (const f of known) for (const v of nameVariants(f.name)) byName.set(v, f)

  for (const ref of references) {
    let target: bigint
    try {
      target = BigInt(ref.originalTarget)
    } catch {
      continue
    }
    const original = byAddress.get(target)
    const named = nameVariants(ref.symbol).map((v) => byName.get(v)).find((f) => f !== undefined)
    const at = `+0x${ref.offset.toString(16)}`

    if (original !== undefined && named !== undefined && named.address !== original.address) {
      return `the candidate calls ${named.name} at ${at}, but the original calls ${original.name} (${hex(original.address)}) there`
    }
    if (
      original !== undefined && named === undefined &&
      plainIdentifier.test(ref.symbol) && plainIdentifier.test(original.name) &&
      !sameName(ref.symbol, original.name)
    ) {
      return `the candidate calls ${ref.symbol} at ${at}, but the original calls ${original.name} (${hex(original.address)}) there`
    }
    if (original === undefined && named !== undefined) {
      return `the candidate refers to ${named.name} at ${at}, but the original refers to ${hex(target)} there, which is not that function`
    }
  }
  return undefined
}
