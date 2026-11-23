/** Text of `integration.txt` when the last match failed the link. */
export const integrationNoteFile = (detail: string): string =>
  `The last translation matched this function compiled alone. When the server linked it with the other matched functions at their original addresses, the linked bytes disagreed.

${detail.trim()}
`

/** Text of `instructions.agent` in a work bundle. Written for the agent, not the person. */
export const agentInstructions = (input: {
  readonly name: string
  readonly language: string
  readonly hasAttempt: boolean
  readonly hasIntegrationNote: boolean
}): string => {
  const attempt = input.hasAttempt
    ? "- attempt.c is the best submission so far. Improve that translation.\n"
    : ""
  const integration = input.hasIntegrationNote
    ? "- integration.txt is why attempt.c matched alone and then failed when the server linked it with the other matched functions. Read it before changing candidate.c.\n"
    : ""
  const integrationClose = input.hasIntegrationNote
    ? "\nintegration.txt is the failure of the translation in attempt.c. That translation already matches original.bin on its own. Change candidate.c so the linked function keeps the length and the bytes integration.txt names. The server still accepts this checkout when candidate.c matches original.bin alone.\n"
    : ""
  return `Translate one function for re-hydra. Write the result to candidate.c in this directory. Leave every other file unchanged.

The function name is ${input.name}. The language is ${input.language}. chunk.json records the compiler, the flags, and the address.

Read these files before writing:
- disassembly.s is the behavior the compiled function has to reproduce.
- pseudocode.c is a decompiler sketch of that behavior. It can be wrong.
- types.h declares the types and the function signature. The server includes this header when it compiles. Use those declarations.
- neighbors.json lists functions this one calls. Call them by those names. Leave their bodies out of candidate.c.
- original.bin is the byte sequence the server compares after compilation.
${attempt}${integration}
candidate.c contains only the translation of ${input.name}. The server compiles that file alone, with types.h included for you, using the recipe in chunk.json. A match means the compiled bytes of ${input.name} equal original.bin after the server masks relocations.
${integrationClose}
When candidate.c is saved, stop. The person who checked out this chunk submits that file.
`
}
