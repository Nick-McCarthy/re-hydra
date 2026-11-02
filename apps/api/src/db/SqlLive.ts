import { PgClient } from "@effect/sql-pg"
import { Config, Redacted } from "effect"

export const SqlLive = PgClient.layerConfig({
  url: Config.Redacted("DATABASE_URL"),
  maxConnections: Config.succeed(10),
  connectTimeout: Config.succeed("5 seconds")
})

/** Non-config variant for scripts that already resolved DATABASE_URL. */
export const SqlLiveFromUrl = (url: string) =>
  PgClient.layer({
    url: Redacted.make(url),
    maxConnections: 10,
    connectTimeout: "5 seconds"
  })
