import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { Config, Effect } from "effect"
import type { LinkJobRequest } from "./domain/Job.js"
import { linkerEmulation, runProcess, truncate, type RunResult } from "./proc.js"
import { resolveEntrySymbol, safeSymbol } from "./symbols.js"
import { resolveToolchain, sameCompiler } from "./toolchain.js"

export type LinkUnitOutcome = {
  readonly symbol: string
  readonly passed: boolean
  readonly detail: string
}

export type LinkEngineResult = {
  readonly compilerOk: boolean
  readonly diagnostics: string
  readonly toolchainDigest: string
  readonly units: ReadonlyArray<LinkUnitOutcome>
}

const failed = (
  symbol: string,
  detail: string
): LinkUnitOutcome => ({ symbol, passed: false, detail: truncate(detail, 2_000) })

const hexBytes = (buf: Uint8Array, start: number, end: number): string => {
  const slice = buf.subarray(start, end)
  return [...slice].map((byte) => byte.toString(16).padStart(2, "0")).join(" ")
}

const mismatchDetail = (original: Buffer, linked: Buffer, address: bigint): string => {
  const length = Math.max(original.length, linked.length)
  for (let i = 0; i < length; i++) {
    if (original[i] !== linked[i]) {
      const from = Math.max(0, i - 4)
      const to = Math.min(length, i + 12)
      return [
        `mismatch at 0x${(address + BigInt(i)).toString(16)}`,
        `original ${hexBytes(original, from, Math.min(to, original.length))}`,
        `linked   ${hexBytes(linked, from, Math.min(to, linked.length))}`
      ].join("\n")
    }
  }
  return "bytes match"
}

/**
 * The linked section has to be the chunk. A longer section is a different
 * function even when the original bytes are a prefix of it.
 */
export const takeLinkedBytes = (
  sectionSize: number,
  fileOff: number,
  elf: Uint8Array,
  originalLength: number
): Uint8Array | undefined => {
  if (sectionSize !== originalLength) return undefined
  if (fileOff < 0 || fileOff + sectionSize > elf.length) return undefined
  return elf.subarray(fileOff, fileOff + sectionSize)
}

const parseAddress = (raw: string): bigint | undefined => {
  const text = raw.trim().toLowerCase()
  if (!/^(?:0x)?[0-9a-f]+$/.test(text)) return undefined
  try {
    return text.startsWith("0x") ? BigInt(text) : BigInt(text)
  } catch {
    return undefined
  }
}

type Section = {
  readonly name: string
  readonly size: number
  readonly vma: bigint
  readonly fileOff: number
}

const parseSections = (headers: string): ReadonlyArray<Section> => {
  const sections: Array<Section> = []
  const re =
    /^\s*\d+\s+(\S+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+[0-9a-fA-F]+\s+([0-9a-fA-F]+)\s+/
  for (const line of headers.split(/\r?\n/)) {
    const match = re.exec(line)
    if (match === null || match[1] === undefined || match[2] === undefined || match[3] === undefined || match[4] === undefined) {
      continue
    }
    sections.push({
      name: match[1],
      size: Number.parseInt(match[2], 16),
      vma: BigInt(`0x${match[3]}`),
      fileOff: Number.parseInt(match[4], 16)
    })
  }
  return sections
}

const catchRun = (effect: Effect.Effect<RunResult, Error>): Effect.Effect<RunResult> =>
  effect.pipe(
    Effect.catch((err) =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: String(err)
      } satisfies RunResult)
    )
  )

export const runLinkJob = Effect.fn("runLinkJob")(function*(job: LinkJobRequest) {
  const language = job.language
  const compilerName = language === "cpp" ? "MATCHD_GXX" : "MATCHD_GCC"
  const compilerDefault = language === "cpp" ? "g++" : "gcc"
  const compiler = yield* Config.String(compilerName).pipe(Config.withDefault(compilerDefault))
  const ld = yield* Config.String("MATCHD_LD").pipe(Config.withDefault("ld"))
  const nm = yield* Config.String("MATCHD_NM").pipe(Config.withDefault("nm"))
  const objdump = yield* Config.String("MATCHD_OBJDUMP").pipe(Config.withDefault("objdump"))
  const timeoutMs = yield* Config.Int("MATCHD_TIMEOUT_MS").pipe(Config.withDefault(30_000))
  const extension = language === "cpp" ? "cpp" : "c"

  const version = yield* catchRun(runProcess(compiler, ["--version"], process.cwd(), timeoutMs))
  const flags = [...(job.flags ?? job.toolchain.flags)]
  const unavailable = (diagnostics: string, toolchainDigest: string): LinkEngineResult => ({
    compilerOk: false,
    diagnostics: truncate(diagnostics),
    toolchainDigest,
    units: job.units.map((unit) => failed(unit.symbol, "compiler unavailable"))
  })

  if (version.code !== 0) {
    return unavailable(
      `${compiler} unavailable: ${version.stderr || version.stdout}`,
      "sha256:v2:unavailable"
    )
  }

  const resolved = yield* resolveToolchain(compiler, language, flags, process.cwd(), timeoutMs)
  if (!resolved.ok) {
    return unavailable(resolved.reason, "sha256:v2:unavailable")
  }
  if (!sameCompiler(job.expectedToolchainDigest, resolved.compilerSha256, resolved.assemblerSha256)) {
    return unavailable(
      `compiler mismatch: this machine is ${resolved.digest}, job required ${job.expectedToolchainDigest}`,
      resolved.digest
    )
  }
  const toolchainDigest = resolved.digest

  const work = yield* Effect.tryPromise({
    try: () => mkdtemp(path.join(tmpdir(), "rehydra-link-")),
    catch: (cause) => new Error(String(cause))
  }).pipe(Effect.orDie)

  const cleanup = Effect.tryPromise({
    try: () => rm(work, { recursive: true, force: true }),
    catch: () => undefined
  }).pipe(Effect.ignore)

  return yield* Effect.gen(function*() {
    yield* Effect.tryPromise({
      try: () => writeFile(path.join(work, "types.h"), job.headers, "utf8"),
      catch: (cause) => new Error(String(cause))
    }).pipe(Effect.orDie)

    const compileFlags = [...flags]
    if (!compileFlags.includes("-c")) compileFlags.unshift("-c")
    if (!compileFlags.some((flag) => flag === "-I." || flag.startsWith("-I"))) {
      compileFlags.push("-I.")
    }
    for (const flag of ["-ffunction-sections", "-falign-functions=1", "-fno-asynchronous-unwind-tables"]) {
      if (!compileFlags.includes(flag)) compileFlags.push(flag)
    }
    if (job.headers.trim().length > 0 && !compileFlags.includes("-include")) {
      compileFlags.push("-include", "types.h")
    }

    const outcomes = new Map<string, LinkUnitOutcome>()
    const objects: Array<{ readonly file: string; readonly symbol: string; readonly mangled: string; readonly address: bigint }> = []

    for (let index = 0; index < job.units.length; index++) {
      const unit = job.units[index]
      if (unit === undefined) continue
      const address = parseAddress(unit.address)
      if (address === undefined) {
        outcomes.set(unit.symbol, failed(unit.symbol, `bad address ${unit.address}`))
        continue
      }
      const sourceName = `unit${index}.${extension}`
      const objectName = `unit${index}.o`
      yield* Effect.tryPromise({
        try: () => writeFile(path.join(work, sourceName), unit.source, "utf8"),
        catch: (cause) => new Error(String(cause))
      }).pipe(Effect.orDie)

      const compiled = yield* catchRun(
        runProcess(compiler, [...compileFlags, "-o", objectName, sourceName], work, timeoutMs)
      )
      if (compiled.code !== 0) {
        outcomes.set(
          unit.symbol,
          failed(unit.symbol, `compile failed:\n${compiled.stderr || compiled.stdout}`)
        )
        continue
      }

      const mangledNm = yield* catchRun(runProcess(nm, [objectName], work, timeoutMs))
      const demangledNm = yield* catchRun(runProcess(nm, ["-C", objectName], work, timeoutMs))
      const mangled = resolveEntrySymbol(mangledNm.stdout, demangledNm.stdout, unit.symbol)
      if (mangled === undefined || !safeSymbol(mangled)) {
        outcomes.set(
          unit.symbol,
          failed(
            unit.symbol,
            `symbol ${unit.symbol} not found in ${objectName}\n${demangledNm.stdout || mangledNm.stdout}`
          )
        )
        continue
      }
      objects.push({ file: objectName, symbol: unit.symbol, mangled, address })
    }

    if (objects.length === 0) {
      return {
        compilerOk: false,
        diagnostics: "no units compiled",
        toolchainDigest,
        units: job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "not compiled"))
      } satisfies LinkEngineResult
    }

    const script = [
      "SECTIONS",
      "{",
      ...objects.map((object) =>
        `  .text.${object.mangled} 0x${object.address.toString(16)} : { *(.text.${object.mangled}) }`
      ),
      "}"
    ].join("\n")
    yield* Effect.tryPromise({
      try: () => writeFile(path.join(work, "link.ld"), `${script}\n`, "utf8"),
      catch: (cause) => new Error(String(cause))
    }).pipe(Effect.orDie)

    const emulation = linkerEmulation(job.arch)
    const ldArgs = [
      "-nostdlib",
      "--unresolved-symbols=ignore-all",
      ...(emulation !== undefined ? ["-m", emulation] : []),
      "-T",
      "link.ld",
      "-o",
      "image.elf",
      ...objects.map((object) => object.file)
    ]
    const linked = yield* catchRun(runProcess(ld, ldArgs, work, timeoutMs))
    if (linked.code !== 0) {
      return {
        compilerOk: false,
        diagnostics: truncate(`link failed:\n${linked.stderr || linked.stdout}`),
        toolchainDigest,
        units: job.units.map((unit) =>
          outcomes.get(unit.symbol) ?? failed(unit.symbol, "link failed before compare")
        )
      } satisfies LinkEngineResult
    }

    const headers = yield* catchRun(runProcess(objdump, ["-h", "image.elf"], work, timeoutMs))
    if (headers.code !== 0) {
      return {
        compilerOk: false,
        diagnostics: truncate(`objdump failed:\n${headers.stderr || headers.stdout}`),
        toolchainDigest,
        units: job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "objdump failed"))
      } satisfies LinkEngineResult
    }

    const elf = yield* Effect.tryPromise({
      try: () => readFile(path.join(work, "image.elf")),
      catch: (cause) => new Error(String(cause))
    }).pipe(Effect.orDie)
    const sections = parseSections(headers.stdout)

    for (const object of objects) {
      const unit = job.units.find((item) => item.symbol === object.symbol)
      if (unit === undefined) continue
      const section = sections.find((item) => item.name === `.text.${object.mangled}`)
      if (section === undefined) {
        outcomes.set(object.symbol, failed(object.symbol, `section .text.${object.mangled} missing after link`))
        continue
      }
      if (section.vma !== object.address) {
        outcomes.set(
          object.symbol,
          failed(
            object.symbol,
            `placed at 0x${section.vma.toString(16)}, expected 0x${object.address.toString(16)}`
          )
        )
        continue
      }
      const original = Buffer.from(unit.originalBytesBase64, "base64")
      if (original.length !== unit.size) {
        outcomes.set(
          object.symbol,
          failed(object.symbol, `original is ${original.length} bytes, chunk size is ${unit.size}`)
        )
        continue
      }
      const linkedBytes = takeLinkedBytes(section.size, section.fileOff, elf, original.length)
      if (linkedBytes === undefined) {
        outcomes.set(
          object.symbol,
          failed(
            object.symbol,
            `linked section is ${section.size} bytes, original is ${original.length}`
          )
        )
        continue
      }
      if (Buffer.compare(original, linkedBytes) === 0) {
        outcomes.set(object.symbol, {
          symbol: object.symbol,
          passed: true,
          detail: `matched at 0x${object.address.toString(16)} (${original.length} bytes)`
        })
      } else {
        outcomes.set(
          object.symbol,
          failed(object.symbol, mismatchDetail(original, Buffer.from(linkedBytes), object.address))
        )
      }
    }

    const units = job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "no result"))
    const passed = units.filter((unit) => unit.passed).length
    return {
      compilerOk: true,
      diagnostics: `${passed}/${units.length} functions matched at their original addresses`,
      toolchainDigest,
      units
    } satisfies LinkEngineResult
  }).pipe(Effect.ensuring(cleanup))
}, Effect.orDie)
