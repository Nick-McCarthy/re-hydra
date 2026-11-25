import type { Relocation } from "./normalize.js"
import { safeSymbol } from "./symbols.js"

/**
 * An integration build links only the matched functions. Everything else they
 * refer to is either a function the import knows the address of, or something
 * the import never saw (data, string literals, library code). The first kind is
 * defined at its original address so the linked call is exact. The second kind
 * cannot be placed, so its relocated fields are blanked before the compare,
 * the same way an isolated match blanks them.
 */

export type KnownSymbol = {
  readonly name: string
  readonly address: bigint
}

export type ObjectRelocation = Relocation & {
  /** The symbol the field refers to, without its addend. */
  readonly symbol: string
}

const UNDEFINED_NM = /^\s*U\s+(.+?)\s*$/

/** Names from `nm -u`, in output order. */
export const parseUndefined = (dump: string): Array<string> => {
  const names: Array<string> = []
  for (const line of dump.split(/\r?\n/)) {
    const match = UNDEFINED_NM.exec(line)
    if (match?.[1] !== undefined) names.push(match[1])
  }
  return names
}

const RELOC_HEADER = /^RELOCATION RECORDS FOR \[(.+)\]:\s*$/
const RELOC_ROW = /^([0-9a-fA-F]+)\s+(\S+)\s+(.+?)\s*$/

/** `objdump -r` records for one section. Offsets are from the section start. */
export const parseSectionRelocations = (
  dump: string,
  section: string
): Array<ObjectRelocation> => {
  const out: Array<ObjectRelocation> = []
  let inSection = false
  for (const line of dump.split(/\r?\n/)) {
    const header = RELOC_HEADER.exec(line.trim())
    if (header !== null) {
      inSection = header[1] === section
      continue
    }
    if (!inSection) continue
    const row = RELOC_ROW.exec(line.trim())
    if (row === null || row[1] === undefined || row[2] === undefined || row[3] === undefined) continue
    if (row[1].toUpperCase() === "OFFSET") continue
    const offset = Number.parseInt(row[1], 16)
    const named = row[3].replace(/[+-]0x[0-9a-fA-F]+$/, "")
    // MIPS64 (N64 ABI) writes one relocation as up to three records at the
    // same offset; the second and third name *ABS*. They belong to the first.
    const previous = out[out.length - 1]
    const symbol = named === "*ABS*" && previous !== undefined && previous.offset === offset
      ? previous.symbol
      : named
    out.push({ offset, type: row[2], symbol })
  }
  return out
}

const baseName = (demangled: string): string => demangled.replace(/\(.*$/, "").trim()

/**
 * Pick an address for each undefined symbol the import knows. `pairs` holds
 * each undefined name as the object spells it and as `nm -C` prints it. A name
 * the import lists twice at different addresses is left unplaced.
 */
export const assignKnownSymbols = (
  pairs: ReadonlyArray<{ readonly mangled: string; readonly demangled: string }>,
  known: ReadonlyArray<KnownSymbol>,
  linked: ReadonlySet<string>
): Map<string, bigint> => {
  const byName = new Map<string, bigint | null>()
  for (const symbol of known) {
    const prior = byName.get(symbol.name)
    byName.set(symbol.name, prior === undefined || prior === symbol.address ? symbol.address : null)
  }
  const lookup = (name: string): bigint | undefined => byName.get(name) ?? undefined

  const assigned = new Map<string, bigint>()
  for (const pair of pairs) {
    if (linked.has(pair.mangled) || assigned.has(pair.mangled) || !safeSymbol(pair.mangled)) continue
    const address =
      lookup(pair.mangled) ??
      (pair.mangled.startsWith("_") ? lookup(pair.mangled.slice(1)) : undefined) ??
      lookup(pair.demangled) ??
      lookup(baseName(pair.demangled))
    if (address !== undefined) assigned.set(pair.mangled, address)
  }
  return assigned
}

/** Linker script lines that define each assigned symbol. */
export const symbolAssignments = (assigned: ReadonlyMap<string, bigint>): Array<string> =>
  [...assigned].map(([name, address]) => `${name} = 0x${address.toString(16)};`)

export type ObjectSymbol = {
  readonly section: string
  /** Offset of the symbol from the start of its section. */
  readonly value: number
  readonly size: number
}

const SYMTAB_ROW = /^([0-9a-fA-F]+)\s(.{7})\s(\S+)\s+([0-9a-fA-F]+)\s+(?:\.hidden\s+)?(\S+)\s*$/

/** One symbol from `objdump -t` (GNU or LLVM) of a relocatable object. */
export const findObjectSymbol = (dump: string, name: string): ObjectSymbol | undefined => {
  for (const line of dump.split(/\r?\n/)) {
    const row = SYMTAB_ROW.exec(line.trim())
    if (row === null || row[5] !== name || row[1] === undefined || row[3] === undefined || row[4] === undefined) {
      continue
    }
    if (row[3] === "*UND*" || row[3] === "*ABS*") continue
    return { section: row[3], value: Number.parseInt(row[1], 16), size: Number.parseInt(row[4], 16) }
  }
  return undefined
}

export type PlacedUnit = {
  /** Output section that holds this unit's code. */
  readonly output: string
  readonly file: string
  readonly section: string
  /** Where the input section starts, so the function lands on its own address. */
  readonly start: bigint
}

/**
 * Loadable input sections that are not a unit's code: other functions in the
 * objects, data, constants, unwind tables, and each toolchain's own kinds.
 * Listed rather than `*(*)`, because ld.lld also matches its own symbol,
 * string, and relocation tables against `*(*)` and then refuses the mix.
 * Anything not listed is left to the linker; sections that take no address
 * cannot land on a function.
 */
export const SCRATCH_INPUTS = [
  "*(.text .text.* .init .fini .stub .glink)",
  "*(.rodata .rodata.* .rdata .rdata.* .data .data.* .data1 .bss .bss.* COMMON)",
  "*(.tdata .tdata.* .tbss .tbss.* .got .got.* .got2 .toc .toc.* .opd .plt .fixup)",
  "*(.eh_frame .eh_frame.* .gcc_except_table .gcc_except_table.* .init_array .init_array.* .fini_array .fini_array.* .ctors .ctors.* .dtors .dtors.*)",
  "*(.ARM.exidx .ARM.exidx.* .ARM.extab .ARM.extab.* extab extabindex .mwcats .mwcats.* .gnu.linkonce.*)"
].join(" ")

/**
 * Relocations relative to a base register (PowerPC small data on r13 or r2,
 * MIPS $gp). The linker resolves these only against a symbol in a small-data
 * section, and the original's base register value is not known, so their
 * targets get a placeholder there and the fields are blanked.
 */
const BASE_RELATIVE = new Set([
  "R_PPC_EMB_SDA21",
  "R_PPC_EMB_SDA2REL",
  "R_PPC_EMB_SDAI16",
  "R_PPC_EMB_SDA2I16",
  "R_PPC_SDAREL16",
  "R_MIPS_GPREL16",
  "R_MIPS_GPREL32",
  "R_MIPS_LITERAL"
])

export const baseRelativeSymbols = (relocations: ReadonlyArray<ObjectRelocation>): Array<string> =>
  relocations.filter((relocation) => BASE_RELATIVE.has(relocation.type)).map((relocation) => relocation.symbol)

/**
 * Each unit's code section at a fixed address. Small data goes in real .sdata
 * and .sdata2 sections (with a placeholder for each base-relative target) so
 * the linker can resolve those references, and everything else from every
 * object goes in one scratch section. Nothing is left for the linker to place
 * on its own, so nothing can land on top of a function.
 */
export const buildLinkScript = (
  assigned: ReadonlyMap<string, bigint>,
  units: ReadonlyArray<PlacedUnit>,
  scratch: bigint,
  smallData: ReadonlyArray<string> = []
): string =>
  [
    ...symbolAssignments(assigned),
    "SECTIONS",
    "{",
    ...units.map((unit) => `  ${unit.output} 0x${unit.start.toString(16)} : { ${unit.file}(${unit.section}) }`),
    `  .sdata 0x${scratch.toString(16)} : {`,
    "    _SDA_BASE_ = . + 0x8000; _gp = . + 0x7ff0;",
    ...smallData.map((name) => `    ${name} = .; . += 8;`),
    "    *(.sdata .sdata.* .sbss .sbss.* .scommon .lit4 .lit8)",
    "  }",
    "  .sdata2 : { _SDA2_BASE_ = . + 0x8000; *(.sdata2 .sdata2.* .sbss2 .sbss2.*) }",
    `  .rehydra.scratch : { ${SCRATCH_INPUTS} }`,
    "}"
  ].join("\n")

/** Start of the scratch region: past the last function, on a page boundary. */
export const scratchAddress = (ends: ReadonlyArray<bigint>): bigint => {
  const last = ends.reduce((max, end) => (end > max ? end : max), 0n)
  return ((last + 0xfffn) / 0x1000n) * 0x1000n + 0x1000n
}

/** Thumb branch relocations. Their target is Thumb code unless the original interworks. */
const THUMB_BRANCH = new Set([
  "R_ARM_THM_CALL",
  "R_ARM_THM_PC22",
  "R_ARM_THM_JUMP24",
  "R_ARM_THM_JUMP19",
  "R_ARM_THM_JUMP11",
  "R_ARM_THM_JUMP8"
])

/** Symbols reached by a Thumb branch. */
export const thumbCallees = (relocations: ReadonlyArray<ObjectRelocation>): Array<string> =>
  relocations.filter((relocation) => THUMB_BRANCH.has(relocation.type)).map((relocation) => relocation.symbol)

/**
 * Assembler source defining each symbol as a Thumb function at its address.
 * A linker-script assignment would be taken for ARM code.
 */
export const thumbSymbolSource = (assigned: ReadonlyMap<string, bigint>): string =>
  [...assigned].map(([name, address]) => `.global ${name}\n.thumb_set ${name}, 0x${address.toString(16)}\n`).join("")

/** Relocations whose target is neither linked nor defined at a known address. */
export const unplacedRelocations = (
  relocations: ReadonlyArray<ObjectRelocation>,
  placed: ReadonlySet<string>
): Array<ObjectRelocation> => relocations.filter((relocation) => !placed.has(relocation.symbol))
