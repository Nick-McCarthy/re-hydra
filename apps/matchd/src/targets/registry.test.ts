import assert from "node:assert/strict"
import { test } from "node:test"
import { resolveTarget } from "./registry.js"

test("the host gcc images share the x86 family", () => {
  const host = resolveTarget("ghcr.io/re-hydra/gcc:host")
  const seeded = resolveTarget("ghcr.io/re-hydra/gcc:4.8.5@sha256:dev")
  assert.equal(host?.id, "host-gcc")
  assert.equal(seeded?.id, "host-gcc")
  assert.equal(host?.family.id, "x86")
  assert.equal(host?.pin, "gcc-cc1")
  assert.equal(host?.objectFormat, "elf-objdump")
})

test("the n64 gcc 2.8.1 image is big-endian mips", () => {
  const n64 = resolveTarget("ghcr.io/re-hydra/n64-gcc:2.8.1")
  assert.equal(n64?.id, "n64-gcc")
  assert.equal(n64?.family.id, "mips")
  assert.equal(n64?.pin, "gcc-cc1")
  assert.equal(n64?.endian, "big")
  assert.equal(n64?.tools.c.fallback, "mips-linux-gnu-gcc")
  assert.equal(n64?.tools.objdump.fallback, "mips-linux-gnu-objdump")
})

test("the gamecube mwcc image is big-endian powerpc", () => {
  const gc = resolveTarget("ghcr.io/re-hydra/mwcc:gc")
  assert.equal(gc?.id, "gamecube-mwcc")
  assert.equal(gc?.family.id, "ppc")
  assert.equal(gc?.pin, "mwcc")
  assert.equal(gc?.endian, "big")
  assert.equal(gc?.tools.c.fallback, "mwcc-cc")
  assert.equal(gc?.tools.cpp?.fallback, "mwcc-cc")
  assert.equal(gc?.tools.objdump.fallback, "powerpc-linux-gnu-objdump")
})

test("the msvc x64 image reads COFF with clang", () => {
  const msvc = resolveTarget("ghcr.io/re-hydra/clang:msvc-x64")
  assert.equal(msvc?.id, "msvc-x64")
  assert.equal(msvc?.family.id, "x86")
  assert.equal(msvc?.pin, "clang")
  assert.equal(msvc?.objectFormat, "coff-objdump")
  assert.equal(msvc?.endian, "little")
  assert.equal(msvc?.tools.c.fallback, "coff-clang")
  assert.equal(msvc?.tools.objdump.fallback, "llvm-objdump")
})

test("the switch clang image is little-endian aarch64 elf", () => {
  const nx = resolveTarget("ghcr.io/re-hydra/clang:switch")
  assert.equal(nx?.id, "switch-clang")
  assert.equal(nx?.family.id, "aarch64")
  assert.equal(nx?.pin, "clang")
  assert.equal(nx?.objectFormat, "elf-objdump")
  assert.equal(nx?.endian, "little")
  assert.equal(nx?.tools.c.fallback, "switch-clang")
  assert.equal(nx?.tools.cpp?.fallback, "switch-clang")
  assert.equal(nx?.tools.objdump.fallback, "llvm-objdump")
})

test("the ps1 image is little-endian mips elf", () => {
  const ps1 = resolveTarget("ghcr.io/re-hydra/ps1-gcc:mipsel")
  assert.equal(ps1?.id, "ps1-gcc")
  assert.equal(ps1?.family.id, "mips")
  assert.equal(ps1?.pin, "gcc-cc1")
  assert.equal(ps1?.endian, "little")
  assert.equal(ps1?.tools.c.fallback, "mipsel-linux-gnu-gcc")
  assert.equal(ps1?.tools.objdump.fallback, "mipsel-linux-gnu-objdump")
})

test("the ps2 image is little-endian r5900 elf", () => {
  const ps2 = resolveTarget("ghcr.io/re-hydra/ps2-gcc:mips64el")
  assert.equal(ps2?.id, "ps2-gcc")
  assert.equal(ps2?.family.id, "mips")
  assert.equal(ps2?.pin, "gcc-cc1")
  assert.equal(ps2?.endian, "little")
  assert.equal(ps2?.objectFormat, "elf-objdump")
  assert.equal(ps2?.tools.c.fallback, "ps2-gcc")
  assert.equal(ps2?.tools.cpp?.fallback, "ps2-g++")
  assert.equal(ps2?.tools.objdump.fallback, "mips64el-linux-gnuabi64-objdump")
})

test("the psp image is little-endian allegrex elf", () => {
  const psp = resolveTarget("ghcr.io/re-hydra/psp-gcc:allegrex")
  assert.equal(psp?.id, "psp-gcc")
  assert.equal(psp?.family.id, "mips")
  assert.equal(psp?.pin, "gcc-cc1")
  assert.equal(psp?.endian, "little")
  assert.equal(psp?.objectFormat, "elf-objdump")
  assert.equal(psp?.tools.c.fallback, "psp-gcc")
  assert.equal(psp?.tools.cpp?.fallback, "psp-g++")
  assert.equal(psp?.tools.objdump.fallback, "psp-objdump")
})

test("the ps3 image reads ELFv1 code from the dot label", () => {
  const ps3 = resolveTarget("ghcr.io/re-hydra/ps3-gcc:powerpc64")
  assert.equal(ps3?.id, "ps3-gcc")
  assert.equal(ps3?.family.id, "ppc")
  assert.equal(ps3?.pin, "gcc-cc1")
  assert.equal(ps3?.endian, "big")
  assert.equal(ps3?.objectFormat, "elf-objdump")
  assert.equal(ps3?.tools.c.fallback, "powerpc64-linux-gnu-gcc")
  assert.equal(ps3?.tools.objdump.fallback, "ps3-objdump")
})

test("the ps4 image is little-endian x86-64 elf", () => {
  const ps4 = resolveTarget("ghcr.io/re-hydra/clang:ps4")
  assert.equal(ps4?.id, "ps4-clang")
  assert.equal(ps4?.family.id, "x86")
  assert.equal(ps4?.pin, "clang")
  assert.equal(ps4?.objectFormat, "elf-objdump")
  assert.equal(ps4?.endian, "little")
  assert.equal(ps4?.tools.c.fallback, "ps4-clang")
})

test("the original xbox image is i386 coff", () => {
  const xbox = resolveTarget("ghcr.io/re-hydra/clang:xbox")
  assert.equal(xbox?.id, "xbox-i386")
  assert.equal(xbox?.family.id, "x86")
  assert.equal(xbox?.pin, "clang")
  assert.equal(xbox?.objectFormat, "coff-objdump")
  assert.equal(xbox?.tools.c.fallback, "xbox-clang")
})

test("the wii u image is big-endian powerpc elf", () => {
  const wiiu = resolveTarget("ghcr.io/re-hydra/wiiu-gcc:powerpc")
  assert.equal(wiiu?.id, "wiiu-gcc")
  assert.equal(wiiu?.family.id, "ppc")
  assert.equal(wiiu?.pin, "gcc-cc1")
  assert.equal(wiiu?.endian, "big")
  assert.equal(wiiu?.tools.c.fallback, "powerpc-linux-gnu-gcc")
  assert.equal(wiiu?.tools.cpp?.fallback, "powerpc-linux-gnu-g++")
})

test("the dreamcast image is little-endian sh elf", () => {
  const dc = resolveTarget("ghcr.io/re-hydra/dc-gcc:sh4")
  assert.equal(dc?.id, "dc-gcc")
  assert.equal(dc?.family.id, "sh")
  assert.equal(dc?.pin, "gcc-cc1")
  assert.equal(dc?.endian, "little")
  assert.equal(dc?.objectFormat, "elf-objdump")
  assert.equal(dc?.tools.c.fallback, "dc-gcc")
  assert.equal(dc?.tools.cpp?.fallback, "dc-g++")
  assert.equal(dc?.tools.objdump.fallback, "dc-objdump")
})

test("the saturn image is little-endian sh2 elf", () => {
  const saturn = resolveTarget("ghcr.io/re-hydra/saturn-gcc:sh2")
  assert.equal(saturn?.id, "saturn-gcc")
  assert.equal(saturn?.family.id, "sh")
  assert.equal(saturn?.pin, "gcc-cc1")
  assert.equal(saturn?.endian, "little")
  assert.equal(saturn?.objectFormat, "elf-objdump")
  assert.equal(saturn?.tools.c.fallback, "saturn-gcc")
  assert.equal(saturn?.tools.cpp, undefined)
  assert.equal(saturn?.tools.nm.fallback, "sh-elf-nm")
  assert.equal(saturn?.tools.objdump.fallback, "saturn-objdump")
})

test("the genesis image is big-endian 68000 elf", () => {
  const genesis = resolveTarget("ghcr.io/re-hydra/genesis-gcc:68000")
  assert.equal(genesis?.id, "genesis-gcc")
  assert.equal(genesis?.family.id, "m68k")
  assert.equal(genesis?.pin, "gcc-cc1")
  assert.equal(genesis?.endian, "big")
  assert.equal(genesis?.objectFormat, "elf-objdump")
  assert.equal(genesis?.tools.c.fallback, "genesis-gcc")
  assert.equal(genesis?.tools.cpp?.fallback, "genesis-g++")
  assert.equal(genesis?.tools.nm.fallback, "m68k-linux-gnu-nm")
  assert.equal(genesis?.tools.objdump.fallback, "m68k-linux-gnu-objdump")
})

test("an unregistered compiler image is refused", () => {
  assert.equal(resolveTarget("ghcr.io/re-hydra/n64-gcc:2.7.2"), undefined)
})

test("the 3ds image is little-endian armv6k elf", () => {
  const ctr = resolveTarget("ghcr.io/re-hydra/3ds-gcc:arm")
  assert.equal(ctr?.id, "3ds-gcc")
  assert.equal(ctr?.family.id, "arm")
  assert.equal(ctr?.pin, "gcc-cc1")
  assert.equal(ctr?.endian, "little")
  assert.equal(ctr?.objectFormat, "elf-objdump")
  assert.equal(ctr?.tools.c.fallback, "3ds-gcc")
  assert.equal(ctr?.tools.cpp?.fallback, "3ds-g++")
  assert.equal(ctr?.tools.objdump.fallback, "arm-none-eabi-objdump")
})

test("the ds image is little-endian arm elf", () => {
  const ds = resolveTarget("ghcr.io/re-hydra/ds-gcc:arm")
  assert.equal(ds?.id, "ds-gcc")
  assert.equal(ds?.family.id, "arm")
  assert.equal(ds?.pin, "gcc-cc1")
  assert.equal(ds?.endian, "little")
  assert.equal(ds?.objectFormat, "elf-objdump")
  assert.equal(ds?.tools.c.fallback, "arm-none-eabi-gcc")
  assert.equal(ds?.tools.cpp?.fallback, "arm-none-eabi-g++")
  assert.equal(ds?.tools.objdump.fallback, "arm-none-eabi-objdump")
})

test("the gba agbcc image uses the arm family and the agbcc pin", () => {
  const gba = resolveTarget("ghcr.io/re-hydra/agbcc:gba")
  assert.equal(gba?.id, "gba-agbcc")
  assert.equal(gba?.family.id, "arm")
  assert.equal(gba?.pin, "agbcc")
  assert.equal(gba?.tools.c.fallback, "agbcc-cc")
  assert.equal(gba?.tools.cpp, undefined)
  assert.equal(gba?.tools.objdump.fallback, "arm-none-eabi-objdump")
})
