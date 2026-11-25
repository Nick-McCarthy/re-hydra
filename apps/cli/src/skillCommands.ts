import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { say } from "./root.js"
import { HydraExit } from "./work.js"

/**
 * The agent skill that ships with the CLI (skill/SKILL.md), and commands to
 * install it where an agent finds it. The folder name matches the skill's
 * `name`, as the Agent Skills format expects.
 */

export const skillName = "re-hydra"

const skillFile = fileURLToPath(new URL("../skill/SKILL.md", import.meta.url))

const readSkill = Effect.try({
  try: () => readFileSync(skillFile, "utf8"),
  catch: (cause) => new HydraExit({ code: 1, message: `The skill file is missing from this CLI (${skillFile}): ${String(cause)}` })
})

/** Where `install` writes: --dir, else ./.claude/skills with --project, else ~/.claude/skills. */
export const skillTarget = (options: { readonly dir: Option.Option<string>; readonly project: boolean }) => {
  const skillsDir = Option.isSome(options.dir)
    ? path.resolve(options.dir.value)
    : options.project
    ? path.resolve(".claude", "skills")
    : path.join(homedir(), ".claude", "skills")
  return path.join(skillsDir, skillName, "SKILL.md")
}

const install = Command.make(
  "install",
  {
    project: Flag.Boolean("project").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Install into ./.claude/skills in this directory (one project) instead of your home folder")
    ),
    dir: Flag.String("dir").pipe(
      Flag.optional,
      Flag.withDescription("Install into this skills folder instead (for agents that read skills from elsewhere)")
    )
  },
  Effect.fn(function*({ project, dir }) {
    const text = yield* readSkill
    const target = skillTarget({ dir, project })
    const before = existsSync(target) ? readFileSync(target, "utf8") : undefined
    if (before !== text) {
      yield* Effect.try({
        try: () => {
          mkdirSync(path.dirname(target), { recursive: true })
          writeFileSync(target, text, "utf8")
        },
        catch: (cause) => new HydraExit({ code: 1, message: `Could not write ${target}: ${String(cause)}` })
      })
    }
    const outcome = before === undefined ? "installed" : before === text ? "current" : "updated"
    yield* say({ path: target, outcome }, [
      outcome === "installed"
        ? `Installed the ${skillName} skill: ${target}`
        : outcome === "updated"
        ? `Updated the ${skillName} skill: ${target}`
        : `The ${skillName} skill is already current: ${target}`,
      "  An agent that reads skills from this folder now knows how to use hydra.",
      "  Run this again after updating the CLI."
    ])
  })
).pipe(Command.withDescription("Install the agent skill (default ~/.claude/skills/re-hydra/SKILL.md)"))

const print = Command.make(
  "print",
  {},
  Effect.fn(function*() {
    yield* Console.log(yield* readSkill)
  })
).pipe(Command.withDescription("Print the agent skill, to paste into an agent's instructions"))

export const skill = Command.make("skill").pipe(
  Command.withDescription("The agent skill: teaches a coding agent to work with hydra"),
  Command.withSubcommands([install, print])
)
