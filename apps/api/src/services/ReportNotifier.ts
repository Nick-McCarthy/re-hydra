import { Config, Duration, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { type Mail, Mailer } from "./Mailer.js"

/** Most reports listed in one email; the rest go in the next tick's email. */
const BATCH = 50
const EXCERPT = 300

type Pending = {
  readonly id: string
  readonly reason: string
  readonly body: string
  readonly created_at: Date | string
  readonly project_name: string
  readonly project_slug: string
  readonly chunk_name: string | null
  readonly post_body: string | null
  readonly reporter_name: string | null
}

const excerpt = (text: string) => {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT)}…` : flat
}

/** The email every admin gets for one batch. Exported for the unit test. */
export const reportEmail = (
  to: string,
  reports: ReadonlyArray<Pending>,
  adminUrl: string
): Mail => {
  const first = reports[0]
  const subject = reports.length === 1 && first !== undefined
    ? `re-hydra: ${first.reason} report on ${first.project_name}`
    : `re-hydra: ${reports.length} new reports`
  const items = reports.map((report, index) => {
    const target = report.chunk_name !== null
      ? `function ${report.chunk_name} in ${report.project_name} (${report.project_slug})`
      : report.post_body !== null
        ? `a post in ${report.project_name} (${report.project_slug}): "${excerpt(report.post_body)}"`
        : `the project ${report.project_name} (${report.project_slug})`
    return [
      `${index + 1}. ${report.reason.toUpperCase()}: ${target}`,
      `   From ${report.reporter_name ?? "a removed user"} at ${new Date(report.created_at).toISOString()}`,
      `   ${excerpt(report.body)}`
    ].join("\n")
  })
  return {
    to,
    subject,
    text: [
      reports.length === 1 ? "A new report needs a look:" : `${reports.length} new reports need a look:`,
      "",
      items.join("\n\n"),
      "",
      `Act on them at ${adminUrl}`,
      "",
      "You get this because you are a re-hydra site admin."
    ].join("\n")
  }
}

/**
 * Emails site admins about new reports. Each tick claims up to BATCH
 * unnotified reports (SKIP LOCKED, so two API processes never mail the same
 * one), sends every active admin one email listing them, and marks them
 * notified in the same transaction. A failed send rolls the batch back and
 * the next tick tries again, so a report is mailed at least once; an admin
 * may get a repeat if a later admin's send failed.
 *
 * REPORT_NOTIFY_SECONDS sets the tick (default 60), which is also how long a
 * burst of reports waits to be grouped into one email.
 */
export const ReportNotifierLive = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const mailer = yield* Mailer
  const seconds = yield* Config.Int("REPORT_NOTIFY_SECONDS").pipe(Config.withDefault(60))
  const appUrl = (yield* Config.String("APP_URL").pipe(Config.withDefault("http://localhost:5173"))).replace(/\/+$/, "")
  const adminUrl = `${appUrl}/admin`

  const tick = sql.withTransaction(Effect.gen(function*() {
    const pending = yield* sql<Pending>`
      SELECT r.id, r.reason, r.body, r.created_at,
             p.name AS project_name, p.slug AS project_slug,
             c.name AS chunk_name, pp.body AS post_body,
             u.display_name AS reporter_name
      FROM reports r
      JOIN projects p ON p.id = r.project_id
      LEFT JOIN chunks c ON c.id = r.chunk_id
      LEFT JOIN project_posts pp ON pp.id = r.post_id
      LEFT JOIN users u ON u.id = r.reporter_id
      WHERE r.notified_at IS NULL
      ORDER BY r.created_at
      LIMIT ${BATCH}
      FOR UPDATE OF r SKIP LOCKED
    `
    if (pending.length === 0) return

    const admins = yield* sql<{ readonly email: string }>`
      SELECT email FROM users WHERE is_admin AND suspended_at IS NULL ORDER BY email
    `
    if (admins.length === 0) {
      // Left unnotified: the first admin granted gets the backlog.
      return yield* Effect.logWarning(
        `${pending.length} report(s) waiting and no site admin to email. Grant one with npm run api:admin -- grant <email>.`
      )
    }
    for (const admin of admins) {
      yield* mailer.send(reportEmail(admin.email, pending, adminUrl))
    }
    const ids = pending.map((report) => report.id)
    yield* sql`UPDATE reports SET notified_at = now() WHERE id = ANY(${ids}::uuid[])`
    yield* Effect.logInfo(`emailed ${admins.length} admin(s) about ${pending.length} report(s)`)
  }))

  yield* Effect.logInfo(`report notifier started (every ${seconds}s)`)
  yield* tick.pipe(
    Effect.catchCause((cause) => Effect.logWarning("report notifier tick failed; will retry", cause)),
    Effect.andThen(Effect.sleep(Duration.seconds(seconds))),
    Effect.forever,
    Effect.forkScoped
  )
}))
