import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { availableParallelism, tmpdir } from "node:os"
import * as path from "node:path"
import { Config, Effect } from "effect"
import { inlineAsmRefusal, scanInlineAsm } from "./asmCheck.js"
import type { LinkJobRequest } from "./domain/Job.js"
import { readElfSections } from "./elf.js"
import { type CachedUnit, type LinkCache, makeLinkCache, unitCacheKey } from "./linkCache.js"
import { checkFlags, describeRefusal } from "./flagPolicy.js"
import {
  assignKnownSymbols,
  baseRelativeSymbols,
  buildLinkScript,
  findObjectSymbol,
  parseSectionRelocations,
  parseUndefined,
  scratchAddress,
  thumbCallees,
  thumbSymbolSource,
  unplacedRelocations,
  type ObjectRelocation
} from "./linkSymbols.js"
import { maskBytes } from "./normalize.js"
import { linkerEmulation, runProcess, truncate, type RunResult } from "./proc.js"
import { maxFunctionSourceBytes, maxHeadersBytes } from "./sandbox.js"
import { resolveEntrySymbol, safeSymbol } from "./symbols.js"
import { resolveTarget } from "./targets/registry.js"
import { sameCompiler } from "./toolchain.js"
import { resolveToolchain } from "./toolchains/resolve.js"

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

const mismatchDetail = (original: Uint8Array, linked: Uint8Array, address: bigint): string => {
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
 * The function's bytes inside its placed section. The function has to be
 * exactly as long as the original: a longer one is a different function even
 * when the original bytes are a prefix of it.
 */
export const takeFunctionBytes = (
  section: { readonly fileOffset: number; readonly size: number },
  offset: number,
  functionSize: number,
  image: Uint8Array,
  originalLength: number
): Uint8Array | undefined => {
  if (functionSize !== originalLength) return undefined
  if (offset < 0 || offset + functionSize > section.size) return undefined
  const start = section.fileOffset + offset
  if (start < 0 || start + functionSize > image.length) return undefined
  return image.subarray(start, start + functionSize)
}

const parseAddress = (raw: string): bigint | undefined => {
  const text = raw.trim().toLowerCase()
  if (!/^(?:0x)?[0-9a-f]+$/.test(text)) return undefined
  try {
    // Decimal, or hex with 0x, as the job schema allows.
    return BigInt(text)
  } catch {
    return undefined
  }
}

/** One cache per directory and size, shared by every link job in this process. */
const caches = new Map<string, LinkCache>()
const linkCacheFor = (dir: string, maxBytes: number): LinkCache => {
  const id = `${dir}\u0000${maxBytes}`
  const existing = caches.get(id)
  if (existing !== undefined) return existing
  const cache = makeLinkCache(dir, maxBytes)
  caches.set(id, cache)
  return cache
}

const catchRun =(effect: Effect.Effect<RunResult, Error>): Effect.Effect<RunResult> =>
  effect.pipe(
    Effect.catch((err) =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: String(err)
      } satisfies RunResult)
    )
  )

type LinkObject = {
  readonly file: string
  readonly symbol: string
  readonly mangled: string
  readonly address: bigint
  /** The input section holding the function, and the function's offset in it. */
  readonly section: string
  readonly offset: number
  readonly size: number
  readonly relocations: ReadonlyArray<ObjectRelocation>
}

/**
 * Integration build: compile each matched function with the project's own
 * compiler and flags, link them with that target's linker at their original
 * addresses, and compare the linked bytes with the original program.
 */
export const runLinkJob = Effect.fn("runLinkJob")(function*(job: LinkJobRequest) {
  const language = job.language
  const timeoutMs = yield* Config.Int("MATCHD_TIMEOUT_MS").pipe(Config.withDefault(30_000))
  const linkConcurrency = yield* Config.Int("MATCHD_LINK_CONCURRENCY").pipe(
    Config.withDefault(Math.max(1, Math.min(8, availableParallelism())))
  )
  const cacheDir = yield* Config.String("MATCHD_LINK_CACHE_DIR").pipe(
    Config.withDefault(path.join(tmpdir(), "rehydra-link-cache"))
  )
  const cacheBytes = (yield* Config.Int("MATCHD_LINK_CACHE_MB").pipe(Config.withDefault(1024))) * 1024 * 1024
  const extension = language === "cpp" ? "cpp" : "c"
  const flags = [...(job.flags ?? job.toolchain.flags)]
  const unavailable = (diagnostics: string, toolchainDigest: string): LinkEngineResult => ({
    compilerOk: false,
    diagnostics: truncate(diagnostics),
    toolchainDigest,
    units: job.units.map((unit) => failed(unit.symbol, "the integration build could not run"))
  })

  const target = resolveTarget(job.toolchain.image)
  if (target === undefined) {
    return unavailable(`no matchd target for image ${job.toolchain.image}`, "sha256:v2:unavailable")
  }
  if (target.tools.ld === undefined) {
    return unavailable(
      `Integration builds are not available for ${target.id} yet. Its objects are COFF, and this image has no linker that places them at fixed addresses.`,
      "sha256:v2:unavailable"
    )
  }
  // Audit A-013: the same flag allow-list as a checkout compile.
  const flagCheck = checkFlags(target.pin, flags)
  if (!flagCheck.ok) {
    return unavailable(describeRefusal(flagCheck), "sha256:v2:unavailable")
  }
  const compilerSpec = language === "cpp" ? target.tools.cpp : target.tools.c
  if (compilerSpec === undefined) {
    return unavailable(`${target.id} does not compile ${language}`, "sha256:v2:unavailable")
  }
  const tool = (spec: { readonly env: string; readonly fallback: string }) =>
    Config.String(spec.env).pipe(Config.withDefault(spec.fallback))
  const compiler = yield* tool(compilerSpec)
  const nm = yield* tool(target.tools.nm)
  const objdump = yield* tool(target.tools.objdump)
  const ld = yield* tool(target.tools.ld)

  const version = yield* catchRun(runProcess(compiler, ["--version"], process.cwd(), timeoutMs))
  if (version.code !== 0) {
    return unavailable(`${compiler} unavailable: ${version.stderr || version.stdout}`, "sha256:v2:unavailable")
  }
  const resolved = yield* resolveToolchain(target.pin, compiler, language, flags, process.cwd(), timeoutMs)
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

  if (Buffer.byteLength(job.headers, "utf8") > maxHeadersBytes) {
    return unavailable(`headers exceed ${maxHeadersBytes} bytes`, toolchainDigest)
  }
  for (const unit of job.units) {
    if (Buffer.byteLength(unit.source, "utf8") > maxFunctionSourceBytes) {
      return unavailable(`${unit.symbol} exceeds ${maxFunctionSourceBytes} bytes`, toolchainDigest)
    }
  }

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

    // Exactly the flags a checkout match compiles with, so the code is the
    // code that matched.
    const compileFlags = [...flags]
    if (!compileFlags.includes("-c")) compileFlags.unshift("-c")
    if (!compileFlags.some((flag) => flag === "-I." || flag.startsWith("-I"))) {
      compileFlags.push("-I.")
    }
    if (job.headers.trim().length > 0 && !compileFlags.includes("-include")) {
      compileFlags.push("-include", "types.h")
    }

    const outcomes = new Map<string, LinkUnitOutcome>()
    const cache = linkCacheFor(cacheDir, cacheBytes)

    type Prepared =
      | { readonly ok: false; readonly outcome: LinkUnitOutcome }
      | {
        readonly ok: true
        readonly object: LinkObject
        readonly undefinedPairs: ReadonlyArray<{ readonly mangled: string; readonly demangled: string }>
        readonly cached: boolean
      }

    const fail = (symbol: string, detail: string): Prepared => ({ ok: false, outcome: failed(symbol, detail) })

    /**
     * One unit's object and what the link needs to know about it: from the
     * cache when this exact compile was done before, otherwise compiled and
     * read here, then cached.
     */
    const prepare = (unit: LinkJobRequest["units"][number], index: number) =>
      Effect.gen(function*() {
        const address = parseAddress(unit.address)
        if (address === undefined) return fail(unit.symbol, `bad address ${unit.address}`)
        const sourceName = `unit${index}.${extension}`
        const objectName = `unit${index}.o`
        const objectPath = path.join(work, objectName)
        const key = unitCacheKey({
          target: target.id,
          toolchainDigest,
          language,
          flags: compileFlags,
          headers: job.headers,
          symbol: unit.symbol,
          source: unit.source
        })
        const toObject = (meta: CachedUnit, cached: boolean): Prepared => {
          // Audit A-032: the same inline-assembly rule as a checkout match.
          if (meta.asmHit !== null && unit.allowInlineAsm !== true) {
            return fail(unit.symbol, inlineAsmRefusal(meta.asmHit))
          }
          return {
            ok: true,
            cached,
            undefinedPairs: meta.undefinedPairs,
            object: {
              file: objectName,
              symbol: unit.symbol,
              mangled: meta.mangled,
              address,
              section: meta.section,
              offset: meta.offset,
              size: meta.size,
              relocations: meta.relocations
            }
          }
        }

        const hit = yield* cache.get(key, objectPath)
        if (hit !== undefined) return toObject(hit, true)

        yield* Effect.tryPromise({
          try: () => writeFile(path.join(work, sourceName), unit.source, "utf8"),
          catch: (cause) => new Error(String(cause))
        }).pipe(Effect.orDie)

        const asm = yield* scanInlineAsm({
          compiler,
          flags: compileFlags,
          sourceFile: sourceName,
          work,
          timeoutMs,
          rawSources: [{ name: sourceName, text: unit.source }, { name: "types.h", text: job.headers }]
        })
        if (!asm.ok) return fail(unit.symbol, asm.reason)
        // Refuse before compiling; a refused unit is not worth caching.
        if (asm.hit !== undefined && unit.allowInlineAsm !== true) {
          return fail(unit.symbol, inlineAsmRefusal(asm.hit))
        }

        const compiled = yield* catchRun(
          runProcess(compiler, [...compileFlags, "-o", objectName, sourceName], work, timeoutMs)
        )
        if (compiled.code !== 0) return fail(unit.symbol, `compile failed:\n${compiled.stderr || compiled.stdout}`)

        const mangledNm = yield* catchRun(runProcess(nm, [objectName], work, timeoutMs))
        const demangledNm = yield* catchRun(runProcess(nm, ["-C", objectName], work, timeoutMs))
        const mangled = resolveEntrySymbol(mangledNm.stdout, demangledNm.stdout, unit.symbol)
        if (mangled === undefined || !safeSymbol(mangled)) {
          return fail(unit.symbol, `symbol ${unit.symbol} not found in ${objectName}\n${demangledNm.stdout || mangledNm.stdout}`)
        }

        const table = yield* catchRun(runProcess(objdump, ["-t", objectName], work, timeoutMs))
        const found = findObjectSymbol(table.stdout, mangled)
        if (found === undefined) return fail(unit.symbol, `symbol ${mangled} missing from the symbol table of ${objectName}`)
        // ELFv1 PowerPC puts the function symbol on its descriptor in .opd; the
        // code itself starts the object's .text.
        const inCode = found.section.startsWith(".text")
        const section = inCode ? found.section : ".text"
        const offset = inCode ? found.value : 0

        const dump = yield* catchRun(runProcess(objdump, ["-r", objectName], work, timeoutMs))
        if (dump.code !== 0) return fail(unit.symbol, `objdump -r failed: ${dump.stderr || dump.stdout}`)
        const relocations = parseSectionRelocations(dump.stdout, section)
          .map((relocation) => ({ ...relocation, offset: relocation.offset - offset }))
          .filter((relocation) => relocation.offset >= 0 && relocation.offset < found.size)

        const plain = yield* catchRun(runProcess(nm, ["-u", objectName], work, timeoutMs))
        const pretty = yield* catchRun(runProcess(nm, ["-u", "-C", objectName], work, timeoutMs))
        const demangledNames = parseUndefined(pretty.stdout)
        const undefinedPairs = parseUndefined(plain.stdout).map((name, at) => ({
          mangled: name,
          demangled: demangledNames[at] ?? name
        }))

        const meta: CachedUnit = {
          version: 1,
          asmHit: asm.hit ?? null,
          mangled,
          section,
          offset,
          size: found.size,
          relocations,
          undefinedPairs
        }
        yield* cache.put(key, meta, objectPath)
        return toObject(meta, false)
      })

    // Units are independent until the link, so they compile side by side.
    const prepared = yield* Effect.forEach(job.units, prepare, { concurrency: linkConcurrency })
    const objects: Array<LinkObject> = []
    const undefinedPairs: Array<{ mangled: string; demangled: string }> = []
    let reused = 0
    prepared.forEach((result, index) => {
      const unit = job.units[index]
      if (unit === undefined) return
      if (!result.ok) {
        outcomes.set(unit.symbol, result.outcome)
        return
      }
      if (result.cached) reused++
      objects.push(result.object)
      undefinedPairs.push(...result.undefinedPairs)
    })

    if (objects.length === 0) {
      return {
        compilerOk: false,
        diagnostics: "no units compiled",
        toolchainDigest,
        units: job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "not compiled"))
      } satisfies LinkEngineResult
    }

    const starts = objects.map((object) => object.address - BigInt(object.offset))
    if (starts.some((start) => start < 0n)) {
      return {
        compilerOk: false,
        diagnostics: "a function's code section would start below address 0",
        toolchainDigest,
        units: job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "could not be placed"))
      } satisfies LinkEngineResult
    }

    // Functions the import knows but this build does not link, and the
    // globals and thunks the export listed, are defined at their original
    // addresses. Anything else cannot be placed; its fields are blanked.
    const known = (job.symbols ?? []).flatMap((symbol) => {
      const address = parseAddress(symbol.address)
      return address === undefined ? [] : [{ name: symbol.name, address }]
    })
    const linkedNames = new Set(objects.map((object) => object.mangled))
    const smallData = [...new Set(objects.flatMap((object) => baseRelativeSymbols(object.relocations)))]
      .filter((name) => !linkedNames.has(name) && safeSymbol(name) && undefinedPairs.some((pair) => pair.mangled === name))
    const smallDataNames = new Set(smallData)
    const assigned = assignKnownSymbols(
      undefinedPairs.filter((pair) => !smallDataNames.has(pair.mangled)),
      known,
      linkedNames
    )

    const placed = objects.map((object, index) => ({
      output: `.rehydra.u${index}`,
      file: object.file,
      section: object.section,
      start: starts[index] ?? 0n
    }))
    const scratch = scratchAddress(objects.map((object) => object.address + BigInt(object.size)))

    // ARM: a known callee of a Thumb branch is defined as a Thumb function in
    // an assembled object, so the call links straight to it without a veneer.
    const extraObjects: Array<string> = []
    let scriptSymbols: ReadonlyMap<string, bigint> = assigned
    if (target.tools.thumbAs !== undefined) {
      const thumbNames = new Set(objects.flatMap((object) => thumbCallees(object.relocations)))
      const thumb = new Map([...assigned].filter(([name]) => thumbNames.has(name)))
      if (thumb.size > 0) {
        const thumbAs = yield* tool(target.tools.thumbAs)
        yield* Effect.tryPromise({
          try: () => writeFile(path.join(work, "thumb.s"), thumbSymbolSource(thumb), "utf8"),
          catch: (cause) => new Error(String(cause))
        }).pipe(Effect.orDie)
        const assembled = yield* catchRun(runProcess(thumbAs, ["-o", "thumb.o", "thumb.s"], work, timeoutMs))
        if (assembled.code !== 0) {
          return {
            compilerOk: false,
            diagnostics: truncate(`could not define Thumb symbols:\n${assembled.stderr || assembled.stdout}`),
            toolchainDigest,
            units: job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "link failed before compare"))
          } satisfies LinkEngineResult
        }
        extraObjects.push("thumb.o")
        scriptSymbols = new Map([...assigned].filter(([name]) => !thumb.has(name)))
      }
    }

    yield* Effect.tryPromise({
      try: () => writeFile(path.join(work, "link.ld"), `${buildLinkScript(scriptSymbols, placed, scratch, smallData)}\n`, "utf8"),
      catch: (cause) => new Error(String(cause))
    }).pipe(Effect.orDie)

    const emulation = target.id === "host-gcc" ? linkerEmulation(job.arch) : undefined
    const linked = yield* catchRun(runProcess(ld, [
      "-nostdlib",
      "--unresolved-symbols=ignore-all",
      ...(emulation !== undefined ? ["-m", emulation] : []),
      ...(target.tools.ldFlags ?? []),
      "-T",
      "link.ld",
      "-o",
      "image.elf",
      ...objects.map((object) => object.file),
      ...extraObjects
    ], work, timeoutMs))
    if (linked.code !== 0) {
      return {
        compilerOk: false,
        diagnostics: truncate(`link failed:\n${linked.stderr || linked.stdout}`),
        toolchainDigest,
        units: job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "link failed before compare"))
      } satisfies LinkEngineResult
    }

    const image = yield* Effect.tryPromise({
      try: () => readFile(path.join(work, "image.elf")),
      catch: (cause) => new Error(String(cause))
    }).pipe(Effect.orDie)
    const sections = readElfSections(image)
    if ("reason" in sections) {
      return {
        compilerOk: false,
        diagnostics: sections.reason,
        toolchainDigest,
        units: job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, sections.reason))
      } satisfies LinkEngineResult
    }

    objects.forEach((object, index) => {
      const unit = job.units.find((item) => item.symbol === object.symbol)
      const plan = placed[index]
      if (unit === undefined || plan === undefined) return
      const section = sections.find((item) => item.name === plan.output)
      if (section === undefined || !section.inFile) {
        outcomes.set(object.symbol, failed(object.symbol, `section ${object.section} missing after link`))
        return
      }
      if (section.address !== plan.start) {
        outcomes.set(
          object.symbol,
          failed(object.symbol, `placed at 0x${(section.address + BigInt(object.offset)).toString(16)}, expected 0x${object.address.toString(16)}`)
        )
        return
      }
      const original = Buffer.from(unit.originalBytesBase64, "base64")
      if (original.length !== unit.size) {
        outcomes.set(object.symbol, failed(object.symbol, `original is ${original.length} bytes, chunk size is ${unit.size}`))
        return
      }
      const linkedBytes = takeFunctionBytes(section, object.offset, object.size, image, original.length)
      if (linkedBytes === undefined) {
        outcomes.set(
          object.symbol,
          failed(object.symbol, `linked function is ${object.size} bytes, original is ${original.length}`)
        )
        return
      }

      // An absolute (*ABS*) target is a known value, not a reference to place.
      const ownPlaced = new Set<string>([...linkedNames, ...assigned.keys(), object.section, "*ABS*"])
      const unplaced = unplacedRelocations(object.relocations, ownPlaced)
      const left = maskBytes(original, unplaced, target.family.relocationWidth, target.endian)
      const right = maskBytes(linkedBytes, unplaced, target.family.relocationWidth, target.endian)
      if ("reason" in left || "reason" in right) {
        const reason = "reason" in left ? left.reason : "reason" in right ? right.reason : ""
        outcomes.set(object.symbol, failed(object.symbol, reason))
        return
      }
      const names = [...new Set(unplaced.map((relocation) => relocation.symbol))]
      const note = unplaced.length === 0
        ? ""
        : `; ${unplaced.length} ${unplaced.length === 1 ? "reference" : "references"} to code or data outside the import not compared (${names.slice(0, 5).join(", ")}${names.length > 5 ? ", …" : ""})`
      if (Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0) {
        outcomes.set(object.symbol, {
          symbol: object.symbol,
          passed: true,
          detail: `matched at 0x${object.address.toString(16)} (${original.length} bytes)${note}`
        })
      } else {
        outcomes.set(object.symbol, failed(object.symbol, mismatchDetail(left, right, object.address)))
      }
    })

    const units = job.units.map((unit) => outcomes.get(unit.symbol) ?? failed(unit.symbol, "no result"))
    const passed = units.filter((unit) => unit.passed).length
    return {
      compilerOk: true,
      diagnostics: `${passed}/${units.length} functions matched at their original addresses` +
        (reused > 0 ? ` (${reused} reused from earlier builds)` : ""),
      toolchainDigest,
      units
    } satisfies LinkEngineResult
  }).pipe(Effect.ensuring(cleanup))
}, Effect.orDie)
