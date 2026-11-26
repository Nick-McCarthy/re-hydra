import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { ApiClient } from "./client.js"
import { currentLease, ensureUrl, hydra, projectOr, say } from "./root.js"
import { ExitCode, hexAddress, HydraExit } from "./work.js"

/**
 * Project-level commands: the type environment and proposals, importing a
 * Ghidra export, and the integration build.
 */

const projectFlag = Flag.String("project").pipe(
  Flag.optional,
  Flag.withDescription("Project slug. Omitted inside a checkout.")
)

const readText = (file: string) =>
  Effect.try({
    try: () => readFileSync(file, "utf8"),
    catch: (cause) => new HydraExit({ code: 1, message: `Could not read ${file}: ${String(cause)}` })
  })

// --- Types -------------------------------------------------------------------

const typesShow = Command.make(
  "show",
  {
    project: projectFlag,
    out: Flag.String("out").pipe(
      Flag.optional,
      Flag.withDescription("Also write the current headers to this file")
    )
  },
  Effect.fn(function*({ project, out }) {
    yield* ensureUrl
    const projectSlug = yield* projectOr(project)
    const client = yield* ApiClient
    const env = yield* client.types.getEnvironment({ params: { projectSlug } })
    const proposals = yield* client.types.listProposals({ params: { projectSlug } })
    const unresolved = yield* client.types.listUnresolved({ params: { projectSlug } })
    const openProposals = proposals.filter((proposal) =>
      proposal.state === "open" || proposal.state === "revalidating" || proposal.state === "ready"
    )
    const stillUnresolved = unresolved.filter((type) => type.clearedAt === undefined)
    if (Option.isSome(out)) {
      writeFileSync(path.resolve(out.value), env.headers)
    }
    yield* say({ ...env, openProposals: openProposals.length, unresolved: stillUnresolved }, [
      `${projectSlug}: type revision ${env.revision} (${env.createdAt})`,
      `  ${env.typeNames.length} type names used by chunks, ${env.headers.length} characters of headers`,
      `  open proposals: ${openProposals.length}${openProposals.length > 0 ? "  (hydra types proposals)" : ""}`,
      `  unresolved:     ${stillUnresolved.length === 0 ? "none" : stillUnresolved.map((type) => type.typeName).join(", ")}`,
      ...(Option.isSome(out) ? [`  headers written to ${path.resolve(out.value)}`] : [])
    ])
  })
).pipe(Command.withDescription("The project's current type revision, open proposals, and unresolved types"))

const typesPropose = Command.make(
  "propose",
  {
    file: Argument.String("file").pipe(
      Argument.optional,
      Argument.withDescription("Full replacement headers (default: types.h in this checkout)")
    ),
    title: Flag.String("title").pipe(Flag.withDescription("What the change is, in a line")),
    description: Flag.String("description").pipe(Flag.optional, Flag.withDescription("Why, and what it fixes")),
    affects: Flag.String("affects").pipe(
      Flag.optional,
      Flag.withDescription("Comma-separated type names whose matched chunks must be rechecked. Default: all")
    ),
    project: projectFlag
  },
  Effect.fn(function*({ file, title, description, affects, project }) {
    yield* ensureUrl
    const projectSlug = yield* projectOr(project)
    const headersPath = Option.isSome(file)
      ? path.resolve(file.value)
      : path.join((yield* currentLease).workDir, "types.h")
    const headers = yield* readText(headersPath)
    const affectedTypes = Option.isSome(affects)
      ? affects.value.split(",").map((name) => name.trim()).filter((name) => name.length > 0)
      : undefined
    const client = yield* ApiClient
    const proposal = yield* client.types.createProposal({
      params: { projectSlug },
      payload: {
        title: title.trim(),
        headers,
        ...(Option.isSome(description) ? { description: description.value } : {}),
        ...(affectedTypes !== undefined && affectedTypes.length > 0 ? { affectedTypes } : {})
      }
    })
    yield* say(proposal, [
      `Proposed "${proposal.title}" (${proposal.id})`,
      `  from:     ${headersPath}`,
      `  affects:  ${proposal.affectedTypes.length === 0 ? "every matched chunk" : proposal.affectedTypes.join(", ")}`,
      `  state:    ${proposal.state}. A maintainer rechecks the matches and accepts it.`
    ])
  })
).pipe(Command.withDescription("Propose new headers for the project (the whole types.h, edited)"))

const typesProposals = Command.make(
  "proposals",
  {
    id: Argument.String("id").pipe(Argument.optional, Argument.withDescription("One proposal, in full")),
    project: projectFlag,
    out: Flag.String("out").pipe(Flag.optional, Flag.withDescription("With an id: write its headers to this file"))
  },
  Effect.fn(function*({ id, project, out }) {
    yield* ensureUrl
    const projectSlug = yield* projectOr(project)
    const client = yield* ApiClient
    if (Option.isNone(id)) {
      const rows = yield* client.types.listProposals({ params: { projectSlug } })
      yield* say(
        rows,
        rows.length === 0
          ? ["No type proposals."]
          : rows.map((row) => `${row.id}  ${row.state.padEnd(12)}  ${row.createdAt.slice(0, 10)}  ${row.title}`)
      )
      return
    }
    const proposal = yield* client.types.getProposal({ params: { projectSlug, proposalId: id.value } })
    if (Option.isSome(out) && proposal.headers !== undefined) {
      writeFileSync(path.resolve(out.value), proposal.headers)
    }
    const recheck = proposal.revalidationTotal === 0
      ? proposal.state === "open" ? "not started" : "nothing to recheck"
      : `${proposal.revalidationDone}/${proposal.revalidationTotal} done, ${proposal.revalidationFailed} failed, ` +
        `${proposal.revalidationUnchecked} could not run`
    yield* say(proposal, [
      `${proposal.title}  (${proposal.state})`,
      ...(proposal.description.length > 0 ? [`  ${proposal.description}`] : []),
      `  affects:  ${proposal.affectedTypes.length === 0 ? "every matched chunk" : proposal.affectedTypes.join(", ")}`,
      `  recheck:  ${recheck}`,
      `  created:  ${proposal.createdAt}${proposal.closedAt !== undefined ? `, closed ${proposal.closedAt}` : ""}`,
      ...(Option.isSome(out) ? [`  headers written to ${path.resolve(out.value)}`] : [])
    ])
  })
).pipe(Command.withDescription("List type proposals, or show one"))

const typesRecheck = Command.make(
  "recheck",
  { id: Argument.String("id").pipe(Argument.withDescription("Proposal id")), project: projectFlag },
  Effect.fn(function*({ id, project }) {
    yield* ensureUrl
    const projectSlug = yield* projectOr(project)
    const client = yield* ApiClient
    const proposal = yield* client.types.startRevalidation({ params: { projectSlug, proposalId: id } })
    yield* say(
      proposal,
      proposal.revalidationTotal === 0
        ? [`Nothing to recheck: no matched chunk uses those types. "${proposal.title}" is ${proposal.state}.`]
        : [
          `Rechecking ${proposal.revalidationTotal} matched chunk(s) against "${proposal.title}".`,
          `  Follow it with: hydra types proposals ${proposal.id}`
        ]
    )
  })
).pipe(Command.withDescription("Maintainers: recheck matched chunks against a proposal's headers"))

const typesAccept = Command.make(
  "accept",
  { id: Argument.String("id").pipe(Argument.withDescription("Proposal id")), project: projectFlag },
  Effect.fn(function*({ id, project }) {
    yield* ensureUrl
    const projectSlug = yield* projectOr(project)
    const client = yield* ApiClient
    // A refusal says why (not rechecked yet, still rechecking, same reviewer).
    const proposal = yield* client.types.acceptProposal({ params: { projectSlug, proposalId: id } })
    yield* say(proposal, [`Accepted "${proposal.title}". New checkouts get the new headers; run hydra refresh in open ones.`])
  })
).pipe(Command.withDescription("Maintainers: accept a rechecked proposal as the next type revision"))

const typesUnresolved = Command.make(
  "unresolved",
  {
    name: Argument.String("type").pipe(
      Argument.optional,
      Argument.withDescription("Mark this type as unresolved. Without it, list them")
    ),
    reason: Flag.String("reason").pipe(Flag.optional, Flag.withDescription("What is missing or wrong")),
    clear: Flag.Boolean("clear").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Maintainers: clear the mark instead")
    ),
    project: projectFlag
  },
  Effect.fn(function*({ name, reason, clear, project }) {
    yield* ensureUrl
    const projectSlug = yield* projectOr(project)
    const client = yield* ApiClient
    if (Option.isNone(name)) {
      const rows = (yield* client.types.listUnresolved({ params: { projectSlug } }))
        .filter((row) => row.clearedAt === undefined)
      yield* say(
        rows,
        rows.length === 0
          ? ["No unresolved types."]
          : rows.map((row) => `${row.typeName.padEnd(24)}  ${row.reason}`)
      )
      return
    }
    if (clear) {
      const row = yield* client.types.clearUnresolved({ params: { projectSlug, typeName: name.value } })
      yield* say(row, [`Cleared ${row.typeName}.`])
      return
    }
    const row = yield* client.types.markUnresolved({
      params: { projectSlug },
      payload: { typeName: name.value, ...(Option.isSome(reason) ? { reason: reason.value } : {}) }
    })
    yield* say(row, [`Marked ${row.typeName} as unresolved. Maintainers see it on the project's types.`])
  })
).pipe(Command.withDescription("List unresolved types, or mark one (a type the headers get wrong or lack)"))

export const types = Command.make("types").pipe(
  Command.withDescription("The project's C types: show, propose changes, mark what is missing"),
  Command.withSubcommands([typesShow, typesPropose, typesProposals, typesRecheck, typesAccept, typesUnresolved])
)

// --- Import ----------------------------------------------------------------------

const CONFIRMATIONS = [
  "I legitimately own a copy of this program.",
  "The export contains only what the policy allows: no full program to download, leaked material, keys, or game assets.",
  "I understand that function bytes and disassembly will be shown to contributors, and names to everyone."
]

export const importExport = Command.make(
  "import",
  {
    project: Argument.String("project").pipe(Argument.withDescription("Project slug")),
    file: Argument.String("file").pipe(Argument.withDescription("The JSON file ExportReHydra wrote")),
    confirmRights: Flag.Boolean("confirm-rights").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Confirm the three statements of content policy 2.3 (printed without this flag)")
    )
  },
  Effect.fn(function*({ project, file, confirmRights }) {
    if (!confirmRights) {
      return yield* new HydraExit({
        code: 1,
        message: [
          "Importing needs your confirmation (content policy, section 2):",
          ...CONFIRMATIONS.map((text) => `  - ${text}`),
          "If all three are true, run it again with --confirm-rights."
        ].join("\n")
      })
    }
    yield* ensureUrl
    const exportPath = path.resolve(file)
    const text = yield* readText(exportPath)
    const payload = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: () => new HydraExit({ code: 1, message: `${exportPath} is not JSON. Export it again with ExportReHydra.` })
    })
    const client = yield* ApiClient
    const root = yield* hydra
    if (!root.json) yield* Console.log(`Importing ${path.basename(exportPath)} (${Math.round(text.length / 1024)} KiB)…`)
    // The client checks the payload against the API's schema before sending.
    const result = yield* client.imports.create({
      params: { projectSlug: project },
      query: { rightsConfirmed: "true" },
      payload: payload as never
    })
    yield* say(result, [
      `Imported into ${project}`,
      `  functions:  ${result.functionsTotal} (${result.functionsCreated} new, ${result.functionsUpdated} updated)`,
      `  types:      revision ${result.typeRevision}`,
      `  next:       hydra next ${project}`
    ])
  })
).pipe(Command.withDescription("Import a Ghidra export (owners and maintainers)"))

// --- Integration -------------------------------------------------------------

const finished = (status: string) => status === "passed" || status === "failed" || status === "error"

export const integrate = Command.make(
  "integrate",
  {
    project: Argument.String("project").pipe(Argument.optional, Argument.withDescription("Project slug. Omitted inside a checkout.")),
    binary: Flag.String("binary").pipe(
      Flag.optional,
      Flag.withDescription("Program id, for a project with more than one")
    ),
    last: Flag.Boolean("last").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Show the latest build instead of starting one")
    ),
    wait: Flag.Int("wait").pipe(
      Flag.withDefault(180),
      Flag.withDescription("Seconds to wait for the build. Default 180; 0 returns at once.")
    ),
    confirmCost: Flag.Boolean("confirm-cost").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Start a build without a terminal (scripts). Builds link every match and are costly.")
    )
  },
  Effect.fn(function*({ project, binary, last, wait, confirmCost }) {
    if (wait < 0) return yield* new HydraExit({ code: 1, message: "--wait cannot be negative." })
    // A speed bump for agents and scripts, which run without a terminal. The
    // server still allows only owners and maintainers to start a build.
    if (!last && !confirmCost && !process.stdin.isTTY) {
      return yield* new HydraExit({
        code: 1,
        message: "An integration build links every matched function and is costly, so it is not started " +
          "without a terminal. A maintainer who means to start one from a script passes --confirm-cost. " +
          "Agents: do not start builds; --last shows the latest one."
      })
    }
    yield* ensureUrl
    const projectSlug = yield* projectOr(project)
    const client = yield* ApiClient
    const root = yield* hydra

    let build
    if (last) {
      const builds = yield* client.projects.listIntegrations({ params: { projectSlug } })
      build = builds[0]
      if (build === undefined) {
        yield* say(null, [`No integration builds in ${projectSlug} yet. Start one with: hydra integrate ${projectSlug}`])
        return
      }
    } else {
      build = yield* client.projects.startIntegration({
        params: { projectSlug },
        payload: Option.isSome(binary) ? { binaryId: binary.value } : {}
      }).pipe(
        // The server says why it refused; add the CLI's flag where it names a field.
        Effect.catchTag("InvalidRequest", (error) =>
          Effect.fail(
            new HydraExit({
              code: 1,
              message: error.reason === "binary_required"
                ? `${error.detail ?? "Name a program."} Pass --binary <id> (shown by hydra list --json as binaryId).`
                : error.detail ?? error.message
            })
          )
        )
      )
      if (!root.json) yield* Console.log(`Started integration build ${build.id}…`)
    }
    for (let i = 0; i < wait && !finished(build.status); i += 2) {
      yield* Effect.sleep("2 seconds")
      build = yield* client.projects.getIntegration({ params: { projectSlug, integrationId: build.id } })
    }

    const failedUnits = build.units.filter((unit) => unit.passed === false)
    const passedUnits = build.units.filter((unit) => unit.passed === true).length
    const lines = [
      `Integration build ${build.id}: ${build.status}`,
      `  ${build.summary}`,
      `  units:  ${passedUnits} passed, ${failedUnits.length} failed, ${build.units.length} in all`
    ]
    for (const unit of failedUnits.slice(0, 20)) {
      lines.push(`  FAIL  ${hexAddress(unit.address)}  ${unit.name}: ${unit.detail.split("\n")[0]}`)
    }
    if (failedUnits.length > 20) lines.push(`  … and ${failedUnits.length - 20} more (--json lists them all)`)
    if (build.status === "error" && build.diagnostics !== null) lines.push("--- diagnostics ---", build.diagnostics)
    if (!finished(build.status)) lines.push(`Still ${build.status}. Check again with: hydra integrate ${projectSlug} --last`)
    yield* say(build, lines)

    if (!finished(build.status)) return yield* new HydraExit({ code: ExitCode.stillChecking, message: "" })
    if (build.status === "failed") return yield* new HydraExit({ code: ExitCode.notMatched, message: "" })
    if (build.status === "error") return yield* new HydraExit({ code: 1, message: "" })
  })
).pipe(Command.withDescription("Start an integration build (link every match) and wait for it; --last shows the latest"))
