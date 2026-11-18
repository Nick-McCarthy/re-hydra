/** Text of `instructions.agent` in a work bundle. Written for the agent, not the person. */
export const agentInstructions = (input: {
  readonly name: string
  readonly language: string
  readonly hasAttempt: boolean
}): string => {
  const attempt = input.hasAttempt
    ? "- attempt.c is the best submission so far. Improve that translation.\n"
    : ""
  return `Translate one function for re-hydra. Write the result to candidate.c in this directory. Leave every other file unchanged.

The function name is ${input.name}. The language is ${input.language}. chunk.json records the compiler, the flags, and the address.

Read these files before writing:
- disassembly.s is the behavior the compiled function has to reproduce.
- pseudocode.c is a decompiler sketch of that behavior. It can be wrong.
- types.h declares the types and the function signature. The server includes this header when it compiles. Use those declarations.
- neighbors.json lists functions this one calls. Call them by those names. Leave their bodies out of candidate.c.
- original.bin is the byte sequence the server compares after compilation.
${attempt}
candidate.c contains only the translation of ${input.name}. The server compiles that file alone, with types.h included for you, using the recipe in chunk.json. A match means the compiled bytes of ${input.name} equal original.bin after the server masks relocations.

When candidate.c is saved, stop. The person who checked out this chunk submits that file.
`
}
