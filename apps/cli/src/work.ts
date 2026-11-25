import * as path from "node:path"
import { Data, Effect, Option, Runtime } from "effect"
import { writeWorkBundle, workDirFor } from "./bundle.js"
import { ApiClient } from "./client.js"
import { writeLease } from "./config.js"

/**
 * Exit codes, so a script or an agent can act on the result without parsing
 * text. 1 is any other failure.
 */
export const ExitCode = {
  /** The attempt finished and is not a match (a miss or a compile error). */
  notMatched: 2,
  /** The attempt was still being checked when the wait ran out. */
  stillChecking: 3,
  /** Not signed in, or the session or token was refused. */
  notSignedIn: 4,
  /** No lease here, or the server no longer has it (expired or released). */
  noLease: 5,
  /** `hydra next` found no open chunk to take. */
  nothingOpen: 6
} as const

/** A failure that has already been explained to the user, with its exit code. */
export class HydraExit extends Data.TaggedError("HydraExit")<{
  readonly message: string
  readonly code: number
}> {
  readonly [Runtime.errorExitCode] = this.code
  /** The message is printed before failing, so the runtime does not log it again. */
  readonly [Runtime.errorReported] = false
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The API sends addresses as decimal strings. */
const apiAddress = (text: string): bigint | undefined => {
  try {
    return BigInt(text)
  } catch {
    return undefined
  }
}

/** Show an address the way disassemblers do. */
export const hexAddress = (text: string): string => {
  const value = apiAddress(text)
  return value === undefined ? text : `0x${value.toString(16)}`
}

/**
 * What an address the user typed could mean: 0x401000 is hex; bare digits may
 * be the hex a disassembler shows or the decimal an older listing showed.
 */
const typedAddresses = (text: string): Array<bigint> => {
  const trimmed = text.trim().toLowerCase()
  if (trimmed.startsWith("0x")) {
    return /^0x[0-9a-f]+$/.test(trimmed) ? [BigInt(trimmed)] : []
  }
  const out: Array<bigint> = []
  if (/^[0-9a-f]+$/.test(trimmed)) out.push(BigInt(`0x${trimmed}`))
  if (/^[0-9]+$/.test(trimmed)) out.push(BigInt(trimmed))
  return out
}

/**
 * A chunk id from what the user typed: its UUID, its exact name, or its
 * address (0x401000 or 401000). Ambiguous or unknown input fails with the
 * closest names, so the next try can be exact.
 */
export const resolveChunkId = Effect.fn("resolveChunkId")(function*(projectSlug: string, input: string) {
  const wanted = input.trim()
  if (UUID.test(wanted)) return wanted
  const client = yield* ApiClient
  const addresses = typedAddresses(wanted)
  const search = (q: string) =>
    client.chunks.list({ params: { projectSlug }, query: { q, limit: 500 } })
  let rows = yield* search(wanted)
  const exact = (candidates: typeof rows) => {
    // A name wins over an address that happens to read the same.
    const named = candidates.filter((chunk) => chunk.name === wanted)
    if (named.length > 0) return named
    return candidates.filter((chunk) => {
      const value = apiAddress(chunk.address)
      return value !== undefined && addresses.includes(value)
    })
  }
  let found = exact(rows)
  if (found.length === 0 && addresses.length > 0 && !wanted.toLowerCase().startsWith("0x")) {
    // The API's search reads bare digits as decimal; try them as hex too.
    rows = yield* search(`0x${wanted}`)
    found = exact(rows)
  }
  if (found.length === 1) return found[0]!.id
  if (found.length > 1) {
    return yield* new HydraExit({
      code: 1,
      message: [
        `"${wanted}" matches ${found.length} chunks. Use the id:`,
        ...found.slice(0, 10).map((chunk) => `  ${chunk.id}  ${hexAddress(chunk.address)}  ${chunk.name}`)
      ].join("\n")
    })
  }
  return yield* new HydraExit({
    code: 1,
    message: rows.length === 0
      ? `No chunk named or at "${wanted}" in ${projectSlug}.`
      : [
        `No chunk named or at "${wanted}" in ${projectSlug}. Close:`,
        ...rows.slice(0, 5).map((chunk) => `  ${chunk.id}  ${hexAddress(chunk.address)}  ${chunk.name}`)
      ].join("\n")
  })
})

/** Claim a chunk, write its work bundle and lease file. */
export const checkoutChunk = Effect.fn("checkoutChunk")(function*(
  projectSlug: string,
  chunkId: string,
  out: Option.Option<string>
) {
  const client = yield* ApiClient
  const lease = yield* client.chunks.checkout({ params: { projectSlug, chunkId } })
  const dir = Option.isSome(out) ? path.resolve(out.value) : workDirFor(projectSlug, lease.chunk.name)
  yield* writeWorkBundle(dir, lease.bundle)
  yield* writeLease({
    projectSlug,
    chunkId: lease.chunk.id,
    chunkName: lease.chunk.name,
    leaseToken: lease.leaseToken,
    leaseExpiresAt: lease.leaseExpiresAt,
    workDir: dir
  })
  return { lease, dir }
})

export const checkoutLines = (
  lease: { readonly chunk: { readonly name: string }; readonly leaseToken: string; readonly leaseExpiresAt: string; readonly bundle: { readonly integrationNote?: string | undefined } },
  dir: string
): Array<string> => [
  `Checked out ${lease.chunk.name}`,
  `  workdir:  ${dir}`,
  `  lease:    ${lease.leaseToken}`,
  `  expires:  ${lease.leaseExpiresAt}`,
  `  agent:    ${path.join(dir, "instructions.agent")}`,
  ...(lease.bundle.integrationNote !== undefined ? [`  link:     ${path.join(dir, "integration.txt")}`] : []),
  `  edit:     ${path.join(dir, "candidate.c")}`,
  "  submit:   hydra submit"
]

/** "in 23m", "in 2h 5m", "expired 4m ago". */
export const untilText = (iso: string, now = Date.now()): string => {
  const ms = new Date(iso).getTime() - now
  const minutes = Math.round(Math.abs(ms) / 60_000)
  const span = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
  return ms >= 0 ? `in ${span}` : `expired ${span} ago`
}

const tagOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string"
    ? error._tag
    : undefined

const detailOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string" &&
    error.detail.length > 0
    ? error.detail
    : undefined

/**
 * For commands that act on a lease: the server answering 404 or 409 means
 * the lease is gone (expired, released, or taken over).
 */
export const leaseGone = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((error) => {
      const tag = tagOf(error)
      if (tag === "Conflict" || tag === "NotFound") {
        return new HydraExit({
          code: ExitCode.noLease,
          message: detailOf(error) ??
            "The server no longer has this lease (it expired or was released). Run hydra checkout again."
        })
      }
      return error
    })
  )

/** One line for any failure, and the exit code that goes with it. */
export const explainFailure = (error: unknown, baseUrl: string): HydraExit => {
  if (error instanceof HydraExit) return error
  const tag = tagOf(error)
  const detail = detailOf(error)
  switch (tag) {
    case "Unauthorized":
      return new HydraExit({ code: ExitCode.notSignedIn, message: "Not signed in, or the session ended. Run: hydra login" })
    case "Forbidden":
      return new HydraExit({ code: 1, message: detail ?? "Not allowed." })
    case "NotFound":
      return new HydraExit({ code: 1, message: detail ?? "Not found. Check the project slug and the chunk." })
    case "Conflict":
      return new HydraExit({ code: 1, message: detail ?? "Not possible in the chunk's current state." })
    case "HttpClientError":
    case "RequestError":
    case "TransportError":
      return new HydraExit({ code: 1, message: `Could not reach the API at ${baseUrl}. Is it running? (--url sets it.)` })
  }
  if (detail !== undefined) return new HydraExit({ code: 1, message: detail })
  if (error instanceof Error && error.message.length > 0) return new HydraExit({ code: 1, message: error.message })
  return new HydraExit({ code: 1, message: String(error) })
}
