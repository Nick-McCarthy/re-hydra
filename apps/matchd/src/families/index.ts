import { aarch64Family } from "./aarch64.js"
import { armFamily } from "./arm.js"
import { m68kFamily } from "./m68k.js"
import { mipsFamily } from "./mips.js"
import { ppcFamily } from "./ppc.js"
import { shFamily } from "./sh.js"
import type { CpuFamily, RelocField } from "./types.js"
import { x86Family } from "./x86.js"

export type { CpuFamily, RelocField } from "./types.js"

/** Add a family here when its relocation widths exist. Consoles do not get their own family file. */
export const cpuFamilies: ReadonlyArray<CpuFamily> = [
  x86Family,
  armFamily,
  aarch64Family,
  mipsFamily,
  ppcFamily,
  shFamily,
  m68kFamily
]

export const relocationWidth = (
  type: string,
  widths: Readonly<Record<string, RelocField>> = allRelocationWidths()
): RelocField | undefined => widths[type]

export const allRelocationWidths = (): Readonly<Record<string, RelocField>> => {
  const widths: Record<string, RelocField> = {}
  for (const family of cpuFamilies) {
    Object.assign(widths, family.relocationWidth)
  }
  return widths
}
