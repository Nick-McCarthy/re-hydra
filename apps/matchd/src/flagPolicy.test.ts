import assert from "node:assert/strict"
import { test } from "node:test"
import { checkFlags, checkFlagsForImage } from "./flagPolicy.js"

const allowed = (family: Parameters<typeof checkFlags>[0], flags: ReadonlyArray<string>) => {
  const result = checkFlags(family, flags)
  assert.equal(result.ok, true, result.ok ? "" : `${result.flag}: ${result.reason}`)
}
const refused = (family: Parameters<typeof checkFlags>[0], flags: ReadonlyArray<string>, flag: string) => {
  const result = checkFlags(family, flags)
  assert.equal(result.ok, false, `expected ${flags.join(" ")} to be refused`)
  if (!result.ok) assert.equal(result.flag, flag)
}

test("ordinary recipes for each family are allowed", () => {
  allowed("gcc-cc1", ["-O2"])
  allowed("gcc-cc1", ["-O2", "-march=armv5te", "-mthumb", "-mthumb-interwork", "-fno-common"])
  allowed("gcc-cc1", ["-O2", "-march=armv6k", "-mtune=mpcore", "-mfpu=vfp", "-mfloat-abi=hard"])
  allowed("gcc-cc1", ["-O2", "-G0", "-EB", "-mips3", "-mabi=32", "-mno-abicalls", "-fno-PIC"])
  allowed("gcc-cc1", ["-O2", "-march=r5900", "-msingle-float", "-ffreestanding", "-std=gnu89"])
  allowed("gcc-cc1", ["-Os", "-m2", "-ml", "-DNDEBUG", "-DVERSION=3", "-UDEBUG", "-Wall", "-Wno-unused"])
  allowed("agbcc", ["-O2", "-mthumb-interwork", "-fhex-asm"])
  allowed("clang", ["--target=aarch64-none-elf", "-O2", "-fms-extensions", "-fms-compatibility-version=19.00"])
  allowed("mwcc", ["-O4,p", "-proc", "gekko", "-fp", "hardware", "-Cpp_exceptions", "off", "-enum", "int", "-sdata", "8", "-inline", "auto"])
})

test("the review's probes are refused", () => {
  refused("gcc-cc1", ["-O2", "-wrapper", "/bin/sh,-c,id"], "-wrapper")
  refused("gcc-cc1", ["-O2", "@/etc/passwd"], "@/etc/passwd")
})

test("flags that run another program are refused", () => {
  refused("gcc-cc1", ["-fplugin=evil.so"], "-fplugin=evil.so")
  refused("gcc-cc1", ["-Bbin"], "-Bbin")
  refused("gcc-cc1", ["-specs=x"], "-specs=x")
  refused("gcc-cc1", ["-Wa,--defsym,x=1"], "-Wa,--defsym,x=1")
  refused("gcc-cc1", ["-Wl,-T,x"], "-Wl,-T,x")
  refused("gcc-cc1", ["-Xassembler"], "-Xassembler")
  refused("clang", ["-Xclang"], "-Xclang")
  refused("clang", ["-mllvm"], "-mllvm")
})

test("flags that read or write named files are refused", () => {
  refused("gcc-cc1", ["-include", "types.h"], "-include")
  refused("gcc-cc1", ["-Iinc"], "-Iinc")
  refused("gcc-cc1", ["-isystem"], "-isystem")
  refused("gcc-cc1", ["--sysroot=x"], "--sysroot=x")
  refused("gcc-cc1", ["-o", "x.o"], "-o")
  refused("gcc-cc1", ["-save-temps"], "-save-temps")
  refused("gcc-cc1", ["-fdump-tree-all"], "-fdump-tree-all")
  refused("gcc-cc1", ["-fprofile-use=x"], "-fprofile-use=x")
  refused("clang", ["-fsanitize-ignorelist=x"], "-fsanitize-ignorelist=x")
  refused("gcc-cc1", ["-S"], "-S")
  refused("gcc-cc1", ["-x", "c"], "-x")
})

test("paths, control characters, and bare words are refused", () => {
  refused("gcc-cc1", ["-DPATH=a/b"], "-DPATH=a/b")
  refused("gcc-cc1", ["-march=..x"], "-march=..x")
  refused("gcc-cc1", ["-DX=1\n-wrapper"], "-DX=1\n-wrapper")
  refused("gcc-cc1", ["evil.c"], "evil.c")
})

test("mwcc: include paths and file outputs are refused, values are checked", () => {
  refused("mwcc", ["-I", "x"], "-I")
  refused("mwcc", ["-ir", "x"], "-ir")
  refused("mwcc", ["--emit-artifacts", "x"], "--emit-artifacts")
  refused("mwcc", ["-proc", "/etc/x"], "/etc/x")
  refused("mwcc", ["-proc"], "-proc")
})

test("an unknown image is refused, a registered one is checked by its family", () => {
  assert.equal(checkFlagsForImage("ghcr.io/evil/image:latest", ["-O2"]).ok, false)
  assert.equal(checkFlagsForImage("ghcr.io/re-hydra/gcc:4.8.5@sha256:dev", ["-O2"]).ok, true)
  assert.equal(checkFlagsForImage("ghcr.io/re-hydra/mwcc:gc", ["-O4,p", "-proc", "gekko"]).ok, true)
  assert.equal(checkFlagsForImage("ghcr.io/re-hydra/clang:switch", ["-wrapper", "x"]).ok, false)
})
