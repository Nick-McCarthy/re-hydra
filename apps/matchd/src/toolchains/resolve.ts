import { Effect } from "effect"
import type { MatchTarget } from "../targets/types.js"
import { resolveAgbccToolchain } from "./agbcc.js"
import { resolveClangToolchain } from "./clang.js"
import { resolveGccToolchain } from "./gcc.js"
import { resolveMwccToolchain } from "./mwcc.js"

/** Hash the backend the target names. A new pin is a new file under toolchains/. */
export const resolveToolchain = Effect.fn("resolveToolchain")(function*(
  pin: MatchTarget["pin"],
  compiler: string,
  language: "c" | "cpp",
  flags: ReadonlyArray<string>,
  cwd: string,
  timeoutMs: number
) {
  if (pin === "gcc-cc1") {
    return yield* resolveGccToolchain(compiler, language, flags, cwd, timeoutMs)
  }
  if (pin === "agbcc") {
    return yield* resolveAgbccToolchain(language, flags)
  }
  if (pin === "mwcc") {
    return yield* resolveMwccToolchain(language, flags)
  }
  return yield* resolveClangToolchain(language, flags)
})
