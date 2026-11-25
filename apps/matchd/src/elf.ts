/**
 * Section headers of a linked ELF image, read from the file itself so the same
 * code works for every target's toolchain (GNU objdump and llvm-objdump print
 * section tables differently). 32- and 64-bit, either byte order.
 */
export type ElfSection = {
  readonly name: string
  readonly address: bigint
  readonly fileOffset: number
  readonly size: number
  /** SHT_NOBITS sections (.bss) have no bytes in the file. */
  readonly inFile: boolean
}

const SHT_NOBITS = 8

export const readElfSections = (file: Uint8Array): ReadonlyArray<ElfSection> | { readonly reason: string } => {
  if (file.length < 0x34 || file[0] !== 0x7f || file[1] !== 0x45 || file[2] !== 0x4c || file[3] !== 0x46) {
    return { reason: "linked image is not ELF" }
  }
  const wide = file[4] === 2
  const little = file[5] === 1
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const u16 = (at: number) => view.getUint16(at, little)
  const u32 = (at: number) => view.getUint32(at, little)
  const word = (at: number): bigint => (wide ? view.getBigUint64(at, little) : BigInt(view.getUint32(at, little)))

  try {
    const shoff = Number(word(wide ? 0x28 : 0x20))
    const shentsize = u16(wide ? 0x3a : 0x2e)
    const shnum = u16(wide ? 0x3c : 0x30)
    const shstrndx = u16(wide ? 0x3e : 0x32)
    if (shoff === 0 || shnum === 0 || shoff + shentsize * shnum > file.length) {
      return { reason: "linked image has no section table" }
    }
    const header = (index: number) => {
      const base = shoff + index * shentsize
      return {
        nameOffset: u32(base),
        type: u32(base + 4),
        address: word(base + (wide ? 0x10 : 0x0c)),
        fileOffset: Number(word(base + (wide ? 0x18 : 0x10))),
        size: Number(word(base + (wide ? 0x20 : 0x14)))
      }
    }
    const names = header(shstrndx)
    const nameAt = (offset: number): string => {
      let end = names.fileOffset + offset
      while (end < file.length && file[end] !== 0) end++
      return Buffer.from(file.subarray(names.fileOffset + offset, end)).toString("latin1")
    }
    const sections: Array<ElfSection> = []
    for (let index = 1; index < shnum; index++) {
      const row = header(index)
      sections.push({
        name: nameAt(row.nameOffset),
        address: row.address,
        fileOffset: row.fileOffset,
        size: row.size,
        inFile: row.type !== SHT_NOBITS
      })
    }
    return sections
  } catch (cause) {
    return { reason: `linked image has a damaged section table: ${String(cause)}` }
  }
}
