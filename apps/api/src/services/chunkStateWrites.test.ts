import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// Chunk state has one owner (roadmap, Next step 2). Only ChunkState.ts may set
// a chunk's state, lease, current match, or fuse parent, or write
// chunk_leases. Other columns on chunks (name, bytes, language override,
// inline assembly, a fused parent's span) may still be updated elsewhere.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const owner = path.join(src, "services", "ChunkState.ts")

const sourceFiles = (dir: string): Array<string> =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return name === "migrations" ? [] : sourceFiles(full)
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : []
  })

const guardedColumn =
  /\b(state|lease_user_id|lease_token|lease_expires_at|hold_started_at|current_match_id|fuse_parent_id)\s*=/

/** Each write in `text` that only ChunkState may make, as the line it starts on. */
const stateWrites = (text: string): Array<number> => {
  const lineOf = (offset: number) => text.slice(0, offset).split("\n").length
  const found: Array<number> = []
  // UPDATE chunks [AS] alias SET ... up to the next FROM, WHERE, or RETURNING.
  const update = /\bUPDATE\s+chunks\b(?:\s+(?:AS\s+)?\w+)?\s+SET\b([\s\S]*?)(?=\bFROM\b|\bWHERE\b|\bRETURNING\b|`)/gi
  for (const match of text.matchAll(update)) {
    if (guardedColumn.test(match[1] ?? "")) found.push(lineOf(match.index))
  }
  for (const match of text.matchAll(/\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+chunk_leases\b/gi)) {
    found.push(lineOf(match.index))
  }
  return found
}

test("chunk state is written only by ChunkState", () => {
  const offenders: Array<string> = []
  for (const file of sourceFiles(src)) {
    if (file === owner) continue
    for (const line of stateWrites(readFileSync(file, "utf8"))) {
      offenders.push(`${path.relative(src, file)}:${line}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test("the check finds the writes in ChunkState", () => {
  // Guards against a pattern that silently matches nothing.
  assert.ok(stateWrites(readFileSync(owner, "utf8")).length >= 15)
  assert.deepEqual(stateWrites("UPDATE chunks SET language_override = 'c', updated_at = now() WHERE id = 1"), [])
  assert.deepEqual(stateWrites("UPDATE chunks AS c SET state = 'open' WHERE id = 1"), [1])
  assert.deepEqual(stateWrites("x\nINSERT INTO chunk_leases (chunk_id) VALUES (1)"), [2])
})
