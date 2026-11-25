import assert from "node:assert/strict"
import { test } from "node:test"
import {
  assignKnownSymbols,
  parseSectionRelocations,
  parseUndefined,
  symbolAssignments,
  thumbCallees,
  thumbSymbolSource,
  unplacedRelocations
} from "./linkSymbols.js"
import { maskBytes } from "./normalize.js"

const relocDump = `
unit1.o:     file format elf64-x86-64

RELOCATION RECORDS FOR [.text.caller]:
OFFSET           TYPE              VALUE
0000000000000005 R_X86_64_PLT32    leaf-0x0000000000000004
000000000000000c R_X86_64_PC32     counter-0x0000000000000004
0000000000000013 R_X86_64_32       .rodata.str1.1


RELOCATION RECORDS FOR [.eh_frame]:
OFFSET           TYPE              VALUE
0000000000000020 R_X86_64_PC32     .text.caller
`

test("relocations are read for one section, without addends", () => {
  assert.deepEqual(parseSectionRelocations(relocDump, ".text.caller"), [
    { offset: 5, type: "R_X86_64_PLT32", symbol: "leaf" },
    { offset: 12, type: "R_X86_64_PC32", symbol: "counter" },
    { offset: 19, type: "R_X86_64_32", symbol: ".rodata.str1.1" }
  ])
  assert.deepEqual(parseSectionRelocations(relocDump, ".text.other"), [])
})

test("MIPS64 relocation triplets name the first record's symbol", () => {
  const dump = [
    "RELOCATION RECORDS FOR [.text]:",
    "OFFSET           TYPE              VALUE",
    "0000000000000008 R_MIPS_GPREL16    counter",
    "0000000000000008 R_MIPS_SUB        *ABS*",
    "0000000000000008 R_MIPS_HI16       *ABS*",
    "0000000000000010 R_MIPS_26         *ABS*"
  ].join("\n")
  assert.deepEqual(parseSectionRelocations(dump, ".text").map((r) => r.symbol), ["counter", "counter", "counter", "*ABS*"])
})

test("callees of Thumb branches are defined as Thumb functions", () => {
  const records = [
    { offset: 2, type: "R_ARM_THM_CALL", symbol: "leaf" },
    { offset: 16, type: "R_ARM_ABS32", symbol: "counter" },
    { offset: 20, type: "R_ARM_CALL", symbol: "arm_helper" }
  ]
  assert.deepEqual(thumbCallees(records), ["leaf"])
  assert.equal(
    thumbSymbolSource(new Map([["leaf", 0x401000n]])),
    ".global leaf\n.thumb_set leaf, 0x401000\n"
  )
})

test("undefined names come from nm -u in order", () => {
  assert.deepEqual(parseUndefined("                 U leaf\n                 U counter\n"), ["leaf", "counter"])
  assert.deepEqual(parseUndefined(""), [])
})

test("only functions the import knows get an address", () => {
  const assigned = assignKnownSymbols(
    [
      { mangled: "leaf", demangled: "leaf" },
      { mangled: "counter", demangled: "counter" },
      { mangled: "caller", demangled: "caller" }
    ],
    [
      { name: "leaf", address: 0x401000n },
      { name: "caller", address: 0x401040n }
    ],
    new Set(["caller"])
  )
  assert.deepEqual([...assigned], [["leaf", 0x401000n]])
  assert.deepEqual(symbolAssignments(assigned), ["leaf = 0x401000;"])
})

test("a C++ name is found through its demangled form", () => {
  const assigned = assignKnownSymbols(
    [{ mangled: "_ZN4Game4tickEi", demangled: "Game::tick(int)" }],
    [{ name: "Game::tick", address: 0x8000n }],
    new Set()
  )
  assert.equal(assigned.get("_ZN4Game4tickEi"), 0x8000n)
})

test("a name listed at two addresses is not guessed", () => {
  const assigned = assignKnownSymbols(
    [{ mangled: "helper", demangled: "helper" }],
    [
      { name: "helper", address: 0x1000n },
      { name: "helper", address: 0x2000n }
    ],
    new Set()
  )
  assert.equal(assigned.size, 0)
})

test("only references nobody can place are blanked", () => {
  const records = parseSectionRelocations(relocDump, ".text.caller")
  const unplaced = unplacedRelocations(records, new Set(["caller", ".text.caller", "leaf"]))
  assert.deepEqual(unplaced.map((r) => r.symbol), ["counter", ".rodata.str1.1"])

  // A PC32 field reads 0 - pc when nothing defines it, so the linked bytes
  // differ from the original there and nowhere else.
  const original = Uint8Array.from([0x8b, 0x05, 0x11, 0x22, 0x33, 0x44, 0xc3])
  const linked = Uint8Array.from([0x8b, 0x05, 0xf6, 0xff, 0xff, 0xff, 0xc3])
  const field = [{ offset: 2, type: "R_X86_64_PC32" }]
  assert.deepEqual(maskBytes(original, field), maskBytes(linked, field))
  const opcode = Uint8Array.from([0x8b, 0x0d, 0xf6, 0xff, 0xff, 0xff, 0xc3])
  assert.notDeepEqual(maskBytes(original, field), maskBytes(opcode, field))
})
