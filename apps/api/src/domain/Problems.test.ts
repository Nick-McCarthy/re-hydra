import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// Refusals must say why (foundations plan, item 1). A bare Conflict or
// BadRequest from HttpApiError leaves clients guessing; use a problem from
// domain/Problems.ts with a reason and a detail instead.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const sourceFiles = (dir: string): Array<string> =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "migrations" ? [] : sourceFiles(full)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : []
  })

test("no bare Conflict or BadRequest is raised", () => {
  const offenders: Array<string> = []
  for (const file of sourceFiles(src)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/)
    lines.forEach((line, index) => {
      if (/new (HttpApiError\.)?(Conflict|BadRequest)\(\)/.test(line)) {
        offenders.push(`${path.relative(src, file)}:${index + 1}`)
      }
    })
  }
  assert.deepEqual(offenders, [])
})

test("no service imports Conflict from HttpApiError", () => {
  const offenders = sourceFiles(path.join(src, "services")).filter((file) =>
    /import \{[^}]*\bConflict\b[^}]*\} from "effect\/http-api\/HttpApiError"/s.test(readFileSync(file, "utf8"))
  )
  assert.deepEqual(offenders.map((file) => path.relative(src, file)), [])
})
