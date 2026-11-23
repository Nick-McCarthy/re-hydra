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

const sections = [
  { id: "what", title: "What does this site do?" },
  { id: "account", title: "How do I sign in?" },
  { id: "systems", title: "Which systems can a project match?" },
  { id: "checkout", title: "How do I finish a function?" },
  { id: "cli", title: "How do I use the hydra tool?" },
  { id: "publish", title: "How does a project owner publish a program?" },
  { id: "maintain", title: "What do owners and maintainers do?" }
] as const

export function FaqPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">FAQ</h1>
        <p className="text-sm text-muted-foreground">
          What the site is for, how to sign in and finish a function, which systems can
          match, and how owners publish and run a project.
        </p>
      </div>

      <nav aria-label="On this page" className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-medium text-muted-foreground">On this page</h2>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="underline-offset-2 hover:underline"
              >
                {index + 1}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Card id="what" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>What does this site do?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            re-hydra takes a program apart one function at a time. Each function is a
            chunk on a project board. A checkout holds that function so two people are
            not translating it at once. The hold ends when the function matches, you
            release it, or the lease runs out.
          </p>
          <p>
            You write the source on your own computer. That can be an agent you run, a
            model account you already pay for, or source you type yourself. You send
            the source to the site. The site compiles it with the compiler and flags
            the project owner chose, and accepts it when the compiled function matches
            the original bytes.
          </p>
          <p>
            The site keeps the checkouts, the shared types, and the proof. It does not
            host a model, and it does not store provider API keys.
          </p>
        </CardContent>
      </Card>

      <Card id="account" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>How do I sign in?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Create an account with a display name, email, and password, then sign in
            from the site. The account menu opens your profile and the password page.
            Changing the password signs out every other browser that was using the
            account. A token you created for the hydra tool keeps working until you
            revoke it on your profile.
          </p>
          <p>
            Your profile is public. The token card appears only when you are signed in
            and looking at your own profile. Name the token, copy the secret once, and
            revoke it later if you lose the machine.
          </p>
        </CardContent>
      </Card>

      <Card id="systems" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>Which systems can a project match?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            A project can match when its compiler is listed as available. That row is a
            public compiler the site runs for you. The retail SDK compiler is a different
            program, so a program built with the SDK will not match this one. Handwritten
            assembly and coprocessor programs stay as bytes.
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

      <Card id="checkout" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>How do I finish a function?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Sign in and open the project. Filter the board by name or address, select
            the functions, and choose Check out above the table. The board shows how
            many you already hold out of the project limit. If another person already
            holds one of the functions you selected, the rest still check out.
          </p>
          <p>
            Work on a row downloads the bundle and is where you submit. Attempts opens
            the history for that function. While the project page stays open, the site
            extends every lease you hold about every five minutes. The hydra tool can
            do the same from the checkout folder.
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
                  the bytes the site compares.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">attempt.c</code> appears
                  only when someone already submitted a best try.
                </li>
                <li>
                  <code className="font-mono whitespace-nowrap">integration.txt</code>{" "}
                  appears when that try matched alone and then failed the link. It
                  names where the linked bytes disagreed.
                </li>
              </ul>
            </li>
            <li>
              Point your agent at{" "}
              <code className="font-mono whitespace-nowrap">instructions.agent</code>.
              That file names the function and the other files in the folder.
            </li>
            <li>
              Put that function in{" "}
              <code className="font-mono whitespace-nowrap">candidate.c</code>. The
              function name has to match the chunk. The site compiles this file with
              the recipe in{" "}
              <code className="font-mono whitespace-nowrap">chunk.json</code> and
              includes <code className="font-mono whitespace-nowrap">types.h</code>{" "}
              itself.
            </li>
            <li>
              Open Work for that function and paste{" "}
              <code className="font-mono whitespace-nowrap">candidate.c</code> into
              Submit translation. The zip does not carry the lease. The open checkout
              is what allows the submit. With hydra, run submit from the checkout
              folder instead of pasting.
            </li>
            <li>
              A match frees the chunk. A miss keeps the lease and shows the compiler
              output or an instruction diff. Change{" "}
              <code className="font-mono whitespace-nowrap">candidate.c</code> and
              submit again. If the function later fails when it is linked with the
              others, the next checkout includes{" "}
              <code className="font-mono whitespace-nowrap">integration.txt</code> and
              the Work dialog has a Link failure tab.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card id="cli" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>How do I use the hydra tool?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            hydra is a program on your computer that does the same checkout and submit
            as the website. On your own profile, create a token and copy the secret
            once. Then save it with{" "}
            <code className="font-mono whitespace-nowrap">hydra login --token</code>.
            Email and password also sign the tool in, and that login is a browser-style
            session. Logging out of a session signs it out. Logging out of a token only
            forgets the copy on that machine.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code className="font-mono whitespace-nowrap">hydra list</code> prints one
              page of functions. Filter with{" "}
              <code className="font-mono whitespace-nowrap">--state</code> and{" "}
              <code className="font-mono whitespace-nowrap">--query</code>.
            </li>
            <li>
              <code className="font-mono whitespace-nowrap">hydra checkout</code> writes
              the same files as the zip, plus{" "}
              <code className="font-mono whitespace-nowrap">.lease.json</code>.
            </li>
            <li>
              <code className="font-mono whitespace-nowrap">hydra submit</code> sends{" "}
              <code className="font-mono whitespace-nowrap">candidate.c</code> and waits
              for the result.
            </li>
            <li>
              <code className="font-mono whitespace-nowrap">hydra watch</code> sits in
              the checkout folder and extends the lease until you stop it. The first
              beat is immediate, then every five minutes.
            </li>
            <li>
              <code className="font-mono whitespace-nowrap">hydra attempts</code> prints
              the history. Inside a checkout it already knows the function.
            </li>
            <li>
              <code className="font-mono whitespace-nowrap">hydra release</code> gives
              the function back.
            </li>
          </ul>
          <p>
            Point the tool at this site with{" "}
            <code className="font-mono whitespace-nowrap">--url</code> when it is not
            already aimed here.{" "}
            <code className="font-mono whitespace-nowrap">--json</code> prints the
            response instead of a sentence.
          </p>
        </CardContent>
      </Card>

      <Card id="publish" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>How does a project owner publish a program?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Start here when Ghidra has finished analyzing the program. These steps
            publish that program as a board other signed-in people can check out.
            Choosing a system stores the public compiler from the table. You do not
            install that compiler yourself.
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
              Sign in, then open New project from the Projects page. The slug is the
              board address, as in <code className="font-mono">/projects/my-game</code>.
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
              Anyone who is signed in can check one out, up to the number of chunks one
              person may hold.
            </li>
          </ol>
        </CardContent>
      </Card>

      <Card id="maintain" className="scroll-mt-6">
        <CardHeader>
          <CardTitle>What do owners and maintainers do?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed">
          <p>
            Owners and maintainers set the rules of a project and repair it when a
            chunk or a type is stuck. Contributors check out chunks and can propose new
            headers. The extra controls show on the project board, in the Work dialog,
            and on the Types page when you have the role.
          </p>
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Set the compiler recipe before matching starts. Choose C or C++ and the
              flags. C++ uses g++. Saving a real change recompiles every current match
              and reopens the ones that miss.
            </li>
            <li>
              Open Work on a function written in the other language and set Language
              override. The rest of the project keeps the recipe. Saving a real change
              rechecks a matched function, and a miss reopens it.
            </li>
            <li>
              Leave Max concurrent leases at 1 so one person holds a function. Raise it
              when several people should work the same function at once. A match still
              takes the function.
            </li>
            <li>
              Chunks one person may hold is how many functions one account can check
              out at once. The default is 8, and the range is 1 to 32. The board shows
              each person how many they hold of that limit.
            </li>
            <li>
              Open a leased function and choose Clear lease when the holder is gone and
              the function should return to the pool. Wait if the function is
              validating.
            </li>
            <li>
              Fuse functions that cannot be proved alone, such as one source function
              split across ranges. Select two or more open, stale, or matched functions
              from the same binary. They become one lease. A matched member loses its
              match.
            </li>
            <li>
              On Types, mark a type unresolved while its layout is still unknown. Open
              and stale functions that use it move to blocked. Clear the mark when the
              layout is settled.
            </li>
            <li>
              When a member opens a type proposal, start revalidation. Matched
              functions compile again under the new headers. Failures return as stale.
              When the project has two or more owners or maintainers, a different one
              accepts the finished proposal.
            </li>
            <li>
              After at least two functions match, choose Link N matched functions. The
              site places those functions at their original addresses and compares the
              linked bytes. A miss reopens that function, and the next checkout includes
              the disagreement in{" "}
              <code className="font-mono whitespace-nowrap">integration.txt</code>. If
              the link fails before that comparison, the matched functions stay matched.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
