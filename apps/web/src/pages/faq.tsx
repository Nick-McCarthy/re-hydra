import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { systemRecipes } from "@/lib/recipes"

type CompatRow = {
  readonly system: string
  readonly cpu: string
  readonly compiler: string
  readonly note: string
  readonly available: boolean
}

const systems: ReadonlyArray<CompatRow> = [
  {
    system: "Nintendo 64",
    cpu: "R4300, big-endian",
    compiler: "GCC 2.8.1",
    note: "IDO and the Nintendo SDK GCC are separate compilers.",
    available: true
  },
  {
    system: "Game Boy Advance",
    cpu: "ARM7TDMI",
    compiler: "agbcc",
    note: "ARM SDT armcc is a separate compiler.",
    available: true
  },
  {
    system: "Nintendo DS",
    cpu: "ARM9 and ARM7",
    compiler: "Debian ARM GCC",
    note: "The recipe flags name ARM9 or ARM7. mwccarm and armcc are separate compilers.",
    available: true
  },
  {
    system: "Nintendo 3DS",
    cpu: "ARM11",
    compiler: "Debian ARM GCC, ARMv6K",
    note: "ARM Compiler 5 is a separate compiler. Hard float is a recipe flag.",
    available: true
  },
  {
    system: "GameCube and Wii",
    cpu: "Gekko / Broadway",
    compiler: "mwcc",
    note: "This is one CodeWarrior reimplementation. The Metrowerks SDK is a separate compiler.",
    available: true
  },
  {
    system: "Wii U",
    cpu: "Espresso, big-endian",
    compiler: "Debian PowerPC GCC",
    note: "The Cafe SDK compiler is a separate program.",
    available: true
  },
  {
    system: "Switch",
    cpu: "AArch64, little-endian",
    compiler: "Debian Clang, AArch64 ELF",
    note: "The Nintendo SDK Clang is a separate program.",
    available: true
  },
  {
    system: "PlayStation",
    cpu: "R3000, little-endian",
    compiler: "Debian MIPS GCC",
    note: "PSY-Q ccpsx is a separate compiler. Many PSY-Q objects are not ELF.",
    available: true
  },
  {
    system: "PlayStation 2",
    cpu: "Emotion Engine",
    compiler: "Debian R5900 GCC",
    note: "Sony ee-gcc is a separate program. VU microcode stays as bytes.",
    available: true
  },
  {
    system: "PlayStation 3",
    cpu: "Cell PPE, big-endian",
    compiler: "Debian PowerPC64 GCC",
    note: "SNC is a separate program. SPU code stays as bytes.",
    available: true
  },
  {
    system: "PlayStation 4",
    cpu: "x86-64",
    compiler: "Debian Clang, FreeBSD ELF",
    note: "The Orbis SDK Clang is a separate program.",
    available: true
  },
  {
    system: "PSP",
    cpu: "Allegrex",
    compiler: "pspdev GCC",
    note: "The Sony SN Systems compiler is a separate program.",
    available: true
  },
  {
    system: "Windows (64-bit)",
    cpu: "x86-64",
    compiler: "Debian Clang, Microsoft x64 COFF",
    note: "A native C or C++ program. Same compiler as Xbox One and Series. Retail Visual C++ is a separate compiler.",
    available: true
  },
  {
    system: "Windows (32-bit)",
    cpu: "x86",
    compiler: "Debian Clang, i386 COFF",
    note: "A native C or C++ program. Same compiler as the original Xbox. Retail Visual C++ is a separate compiler.",
    available: true
  },
  {
    system: "Xbox",
    cpu: "Pentium III",
    compiler: "Debian Clang, i386 COFF",
    note: "Visual C++ 6 and 7 are separate compilers.",
    available: true
  },
  {
    system: "Xbox One and Series",
    cpu: "x86-64",
    compiler: "Debian Clang, Microsoft x64 COFF",
    note: "Retail Visual C++ is a separate compiler.",
    available: true
  },
  {
    system: "Dreamcast",
    cpu: "SH-4, little-endian",
    compiler: "Debian SH-4 GCC",
    note: "The Hitachi compiler is a separate program. AICA sound code stays as bytes.",
    available: true
  },
  {
    system: "Saturn",
    cpu: "SH-2, little-endian",
    compiler: "Debian SH-2 GCC",
    note: "The Hitachi compiler and Sega's GCC 2.7 are separate programs. SCU DSP code stays as bytes.",
    available: true
  },
  {
    system: "Genesis / Mega Drive",
    cpu: "68000, big-endian",
    compiler: "Debian 68000 GCC",
    note: "For a game built with C. SN Systems, Sierra C, and the Sega SDK C compiler are separate programs. The Z80 stays as bytes.",
    available: true
  },
  {
    system: "Xbox 360",
    cpu: "Xenon, big-endian",
    compiler: "—",
    note: "No public compiler emits the retail Xenon object format.",
    available: false
  },
  {
    system: "PlayStation 5",
    cpu: "x86-64",
    compiler: "—",
    note: "Prospero Clang is not installed.",
    available: false
  },
  {
    system: "NES, Game Boy, Game Boy Color, SNES",
    cpu: "6502, SM83, 65816",
    compiler: "—",
    note: "These games are almost all assembly. A modern C compiler produces different bytes from those ROMs.",
    available: false
  }
]

export function FaqPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">FAQ</h1>
        <p className="text-sm text-muted-foreground">
          What the site is for, which systems can match, how to finish a downloaded chunk,
          how a project owner publishes a Ghidra analysis, and how owners and maintainers
          run a project.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What does this site do?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            re-hydra is a place to reverse engineer a binary one function at a time.
            Each function is a chunk. One person holds it until it matches or the lease
            ends, so the same function is not being translated twice.
          </p>
          <p>
            You translate the chunk on your own machine. That can be a local model, an
            API account you already pay for, or source you write yourself. You submit
            the source. The site compiles it with the compiler, version, and flags the
            project owner pinned, and accepts it only when the compiled function matches
            the original bytes.
          </p>
          <p>
            The site keeps the claims, the shared types, and the proof. It does not host
            a model, and it does not store provider API keys.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Which systems can a project match?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            A project can match when its compiler is listed as available. The compiler in
            that row is a public build the site can run. The retail SDK compiler is a
            different program, so a ROM built with the SDK will not match this one.
            Handwritten assembly and coprocessor programs stay as bytes.
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">
                Systems the site can compile, and systems that have no compiler yet
              </caption>
              <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    System
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Compiler
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {systems.map((row) => (
                  <tr key={row.system} className="border-b last:border-0 align-top">
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      {row.system}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {row.cpu}
                      </span>
                    </th>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge variant={row.available ? "success" : "warning"}>
                        {row.available ? "Available" : "Not yet"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{row.compiler}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How do I go from the downloaded zip to a submission?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Download bundle is available after you check out a chunk. The zip is that
            chunk's work bundle. Leave the chunk page open while you work. It extends
            the lease about every five minutes.
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Unzip the download. Each file has one job:
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <code className="font-mono whitespace-nowrap">instructions.agent</code>{" "}
                  tells an agent how to translate this function.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">candidate.c</code> is
                  the file you will submit.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">types.h</code> is the
                  struct and the function signature.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">disassembly.s</code> is
                  what the original bytes do.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">pseudocode.c</code> is a
                  decompiler hint.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">chunk.json</code> names
                  the function and the compiler recipe.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">neighbors.json</code>{" "}
                  lists functions this one calls.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">original.bin</code> is
                  the bytes the server scores against.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">attempt.c</code> appears
                  only when someone already submitted a best try.
                </li>
              </ul>
            </li>
            <li>
              Unzip the download and point your agent at{" "}
              <code className="font-mono whitespace-nowrap">instructions.agent</code>.
              That file names the function and the other files in the folder.
            </li>
            <li>
              Put that function in{" "}
              <code className="font-mono whitespace-nowrap">candidate.c</code>. The
              function name has to match the chunk. The server compiles this file with
              the recipe in{" "}
              <code className="font-mono whitespace-nowrap">chunk.json</code> and
              includes <code className="font-mono whitespace-nowrap">types.h</code>{" "}
              itself.
            </li>
            <li>
              On the chunk page, paste{" "}
              <code className="font-mono whitespace-nowrap">candidate.c</code> into
              Submit translation and submit. The zip does not carry the lease, so the
              open checkout is what allows the submit.
            </li>
            <li>
              A perfect match frees the chunk. A miss keeps the lease and shows the
              compiler output or an instruction diff. Change{" "}
              <code className="font-mono whitespace-nowrap">candidate.c</code> and
              submit again.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How does a project owner set up a project?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Start here when Ghidra has finished analyzing the program. These steps
            publish that program as a board other signed-in people can check out.
            The compiler in the systems table is the one the site will run.
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Download{" "}
              <a
                className="underline underline-offset-2"
                href="/ExportReHydra.java"
                download="ExportReHydra.java"
              >
                ExportReHydra.java
              </a>
              . Leave the file name as it is.
            </li>
            <li>
              In Ghidra, open the analyzed program in the Code Browser. Choose{" "}
              <span className="whitespace-nowrap">Window → Script Manager</span>, then{" "}
              <span className="whitespace-nowrap">Manage Script Directories</span>, and
              add the folder that contains the script. Select{" "}
              <code className="font-mono whitespace-nowrap">ExportReHydra.java</code> and
              run it. Save the JSON when asked. The program file has to still be at the
              path Ghidra imported. The script writes one entry for each defined
              function. External functions, thunks, and functions split across several
              address ranges stay out of the file.{" "}
              <code className="font-mono whitespace-nowrap">MAX_FUNCTIONS</code> at the
              top of the script is <code className="font-mono">0</code>, which means
              every defined function. Set it to a positive number before you run the
              script when you want a smaller first import.
            </li>
            <li>
              Sign in, then open New project from the Projects page. The slug becomes the board
              address, as in <code className="font-mono">/projects/my-game</code>.
              Choose the system, C or C++, and the flags.{" "}
              <code className="font-mono">-O2</code> is the usual start. The form stores
              the compiler and image from the table below. A C++ project uses the same
              image and the matching <code className="font-mono">g++</code> driver when
              the compiler name ends in <code className="font-mono">gcc</code>. Nintendo
              64, Game Boy Advance, and Saturn stay on C. Create project makes you the
              owner.
              <div className="mt-3 overflow-x-auto rounded-md border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <caption className="sr-only">
                    Compiler name and image to store on a new project
                  </caption>
                  <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">
                        System
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Compiler
                      </th>
                      <th scope="col" className="px-4 py-2 font-medium">
                        Image
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {systemRecipes.map((row) => (
                      <tr key={row.system} className="border-b last:border-0 align-top">
                        <th scope="row" className="px-4 py-3 text-left font-medium">
                          {row.system}
                        </th>
                        <td className="px-4 py-3 font-mono text-xs">{row.compiler}</td>
                        <td className="px-4 py-3 font-mono text-xs">{row.image}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </li>
            <li>
              On the new board, drop the JSON onto Import Ghidra export, or click the
              box and choose the file. Each imported function becomes an open chunk.
              Anyone who is signed in can check one out and submit a translation.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What do owners and maintainers do?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Owners and maintainers set the rules of a project and repair it when a
            chunk or a type is stuck. Contributors check out chunks and can propose new
            headers. The extra controls show up on the project, the chunk, and the
            Types page when you have the role.
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Set the compiler recipe before matching starts. Choose C or C++ and the
              flags. C++ uses g++. Saving a real change recompiles every current match
              and reopens the ones that miss.
            </li>
            <li>
              Open a chunk that was written in the other language and set Language
              override. The rest of the project keeps the recipe.
            </li>
            <li>
              Leave Max concurrent leases at 1 so one person holds a chunk. Raise it
              when several people should work the same chunk at once. A match still
              takes the chunk.
            </li>
            <li>
              Open a leased chunk and choose Clear lease when the holder is gone and
              the chunk should return to the pool. Wait if the chunk is validating.
            </li>
            <li>
              Fuse chunks that cannot be proved alone, such as one source function
              split across ranges. Select two or more open, stale, or matched chunks
              from the same binary. They become one lease. A matched member loses its
              match.
            </li>
            <li>
              On Types, mark a type unresolved while its layout is still unknown. Open
              and stale chunks that use it move to blocked. Clear the mark when the
              layout is settled.
            </li>
            <li>
              When a member opens a type proposal, start revalidation. Matched
              functions compile again under the new headers. Failures return as stale.
              When the project has two or more owners or maintainers, a different one
              accepts the finished proposal.
            </li>
            <li>
              After at least two functions match, start an integration build. It links
              those functions at their original addresses. A miss reopens that chunk.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
