import { Config, Effect, Layer } from "effect"
import { tmpdir } from "node:os"
import { runProcess } from "./proc.js"

/**
 * With MATCHD_SANDBOX=bwrap, start one empty sandbox before serving
 * (audit A-027). If the container's seccomp profile or the kernel refuses
 * the user namespace, matchd stops here with bwrap's message. Otherwise
 * every submit would come back as a compiler failure.
 */
export const SandboxSelfTestLive = Layer.effectDiscard(Effect.gen(function*() {
  const mode = yield* Config.String("MATCHD_SANDBOX").pipe(Config.withDefault("off"))
  if (mode !== "bwrap") {
    yield* Effect.logInfo(`compile sandbox ${mode}`)
    return
  }
  const result = yield* runProcess("true", [], tmpdir(), 10_000).pipe(
    Effect.catch((error) => Effect.succeed({ code: -1, stdout: "", stderr: String(error) }))
  )
  if (result.code !== 0) {
    return yield* Effect.die(new Error(
      "MATCHD_SANDBOX=bwrap but the sandbox cannot start. In Docker, run matchd with " +
        "--security-opt seccomp=docker-yml/matchd-seccomp.json. bwrap said: " +
        result.stderr.trim()
    ))
  }
  yield* Effect.logInfo("compile sandbox bwrap: self-test passed")
}))
