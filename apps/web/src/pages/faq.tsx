import * as React from "react"
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
  { id: "match", title: "What counts as a match?" },
  { id: "states", title: "What do the chunk states mean?" },
  { id: "systems", title: "Which systems can a project match?" },
  { id: "checkout", title: "How do I finish a function?" },
  { id: "lease", title: "How long can I hold a function?" },
  { id: "cli", title: "How do I use the hydra tool?" },
  { id: "agent", title: "Can an agent work for me?" },
  { id: "visibility", title: "Who can see my work?" },
  { id: "join", title: "How do I join a members-only project?" },
  { id: "publish", title: "How does a project owner publish a program?" },
  { id: "maintain", title: "What do owners and maintainers do?" }
] as const

function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono whitespace-nowrap">{children}</code>
}

function Section({
  id,
  children
}: {
  id: (typeof sections)[number]["id"]
  children: React.ReactNode
}) {
  const title = sections.find((section) => section.id === id)?.title
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed">{children}</CardContent>
    </Card>
  )
}

const stateRows: ReadonlyArray<{ state: string; meaning: string }> = [
  { state: "open", meaning: "Nobody holds it. Anyone allowed to work on the project can check it out." },
  {
    state: "leased",
    meaning: "Someone holds it and is working on it. It goes back to the pool when they release it or the lease runs out."
  },
  {
    state: "validating",
    meaning: "A submission is being compiled and compared. The holder keeps the lease until the result is in."
  },
  {
    state: "matched",
    meaning: "A submission compiled to the original bytes. The source and the proof are stored, and the chunk is done."
  },
  {
    state: "stale",
    meaning:
      "It used to match, but something it depends on changed: the compiler recipe, a shared type, or an integration build. It can be checked out again, and the old best attempt comes with it."
  },
  {
    state: "blocked",
    meaning:
      "It uses a type a maintainer marked unresolved. It cannot be checked out until the type's layout is settled."
  }
]

export function FaqPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">FAQ</h1>
        <p className="text-sm text-muted-foreground">
          What the site is for, what a match proves, how to finish a function, which
          systems can match, and how owners publish and run a project.
        </p>
      </div>

      <nav aria-label="On this page" className="rounded-lg border bg-card p-6 shadow-sm">
        <h2 className="text-sm font-medium text-muted-foreground">On this page</h2>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="underline-offset-2 hover:underline">
                {index + 1}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="what">
        <p>
          re-hydra helps groups of people rebuild the C or C++ source of an existing
          program, one function at a time. A project owner imports the program's
          functions from Ghidra. Each function becomes a chunk on the project board.
        </p>
        <p>
          You check out a chunk, write source for it on your own computer, and submit
          it. You can write it yourself or use an agent or model you already have. The
          site compiles your source with the compiler and flags the project chose and
          compares the result with the function's original machine code. If they agree,
          the chunk is matched: there is now proof that this source builds that function.
        </p>
        <p>
          The checkout stops two people from doing the same function at once. The site
          keeps the checkouts, the shared types, every attempt, and the proof. It does
          not run a model for you and never asks for your model provider's API key.
        </p>
      </Section>

      <Section id="match">
        <p>
          Your function is compiled on its own, so some bytes can never agree with the
          original: the addresses of other functions and globals are only filled in when
          the whole program is linked. The site blanks exactly those fields, called
          relocations, in both copies and compares everything else. Opcodes, registers,
          and the length must all be identical. A match is all or nothing.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium">Score.</span> A miss reports the share of bytes
            that already agree, such as <Code>score=0.75</Code>. It tells you how close
            you are, not whether you are done.
          </li>
          <li>
            <span className="font-medium">Calls are checked.</span> Blanking hides where a
            call goes, so the site also reads the target from the original bytes. Calling
            the wrong known function is a miss even when every other byte agrees.
          </li>
          <li>
            <span className="font-medium">No inline assembly.</span> Pasting the original
            bytes back in as <Code>asm</Code> would prove nothing, so it is refused. A
            maintainer can allow it for one chunk whose original really was assembly, and
            those matches are marked.
          </li>
          <li>
            <span className="font-medium">Linking is a later check.</span> A match proves
            the function alone. Maintainers can link all matched functions at their
            original addresses as an integration build. That catches mistakes a single
            function cannot show, and a function that fails it is reopened.
          </li>
        </ul>
      </Section>

      <Section id="states">
        <p>Each chunk on the board is in one of these states:</p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">Chunk states and what they mean</caption>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  State
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Meaning
                </th>
              </tr>
            </thead>
            <tbody>
              {stateRows.map((row) => (
                <tr key={row.state} className="border-b last:border-0 align-top">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {row.state}
                  </th>
                  <td className="px-4 py-3 text-muted-foreground">{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Fused chunks act as one: a maintainer can join several functions that only
          make sense together, and they are checked out and matched as a unit.
        </p>
      </Section>

      <Section id="systems">
        <p>
          A match only means something when your source is built by the same compiler
          that built the original, because two compilers turn the same C into different
          bytes. The site runs one public compiler for each available system below.
        </p>
        <p>
          Most commercial games were built with the console maker's licensed SDK
          compiler, which the site cannot ship. A game built with the SDK compiler will
          usually not match the public one, even with perfect source. Check which
          compiler built your program before starting a project. Handwritten assembly
          and coprocessor code (sound chips, vector units) is not C, so it stays as raw
          bytes and is not matched.
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
      </Section>

      <Section id="checkout">
        <p>
          Open the project's Chunks tab. Filter the board by name or address, select one
          or more open or stale functions, and choose Check out. The board shows how many
          you hold out of the project's limit. If someone else already holds one you
          selected, the rest still check out.
        </p>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            Choose Work on the row and download the bundle. Each file has one job:
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <Code>instructions.agent</Code> explains the task. Give it to an agent, or
                read it yourself.
              </li>
              <li>
                <Code>candidate.c</Code> is where your source goes. It is the file you
                submit.
              </li>
              <li>
                <Code>types.h</Code> has the project's shared structs and this function's
                signature. The site includes it for you.
              </li>
              <li>
                <Code>disassembly.s</Code> is the original machine code as instructions.
                This is what you are reproducing.
              </li>
              <li>
                <Code>pseudocode.c</Code> is Ghidra's decompiler output. It is a starting
                point, and it rarely compiles to the same bytes as is.
              </li>
              <li>
                <Code>chunk.json</Code> names the function and the compiler recipe.
              </li>
              <li>
                <Code>neighbors.json</Code> lists the functions this one calls, so you
                can call them by name.
              </li>
              <li>
                <Code>original.bin</Code> is the original bytes the site compares
                against.
              </li>
              <li>
                <Code>attempt.c</Code> is the best earlier try by anyone, when there is
                one. Start from it rather than from scratch.
              </li>
              <li>
                <Code>integration.txt</Code> appears when this function matched alone but
                failed the integration build. It says where the linked bytes disagreed.
              </li>
            </ul>
          </li>
          <li>
            Write the function in <Code>candidate.c</Code>. Its name must be the chunk's
            name. Compare your output with <Code>disassembly.s</Code> as you go: the
            order of statements, the types of variables, and which expressions are
            reused all change the bytes.
          </li>
          <li>
            Open Work again and paste the file into Submit translation, or run{" "}
            <Code>hydra submit</Code> from the checkout folder. Only the person holding
            the lease can submit; the zip by itself is not enough.
          </li>
          <li>
            A match marks the chunk matched and frees it. A miss keeps your lease and
            shows the compiler output and a byte comparison. Change the source and submit
            again as often as you need. Attempts on the row lists every try so far.
          </li>
        </ol>
        <p>
          If you are stuck, start a thread on the Discussion tab and point it at the
          chunk. Release the function when you stop, so someone else can pick it up.
        </p>
      </Section>

      <Section id="lease">
        <p>
          A checkout is a lease. On a new project it lasts 24 hours. While the project
          page is open, the site renews every lease you hold about every five minutes,
          and <Code>hydra watch</Code> does the same from a checkout folder. You can also
          choose Extend on your profile's My work tab.
        </p>
        <p>
          Renewing has a ceiling: one hold can last at most 48 hours from the first
          checkout, so a function nobody is working on goes back to the pool. These are
          the defaults; a project can use other lengths. When a lease runs out, the
          function goes back to the pool (open, or stale if it once matched) and your
          lease token stops working. Your attempts are kept, and your best one is in{" "}
          <Code>attempt.c</Code> for whoever checks the function out next, which can be
          you again.
        </p>
        <p>
          My work on your own profile lists every function you hold across all
          projects, with the time left and buttons to extend or release.
        </p>
      </Section>

      <Section id="cli">
        <p>
          hydra is a command-line program that checks out and submits like the website
          does, so an agent or a script can work without a browser. On your own profile,
          create a token and copy the secret; it is shown only once. Save it with{" "}
          <Code>hydra login --token</Code>. A token works until you revoke it on your
          profile, so revoke it if you lose the machine. You can also log in with email
          and password, which creates an ordinary session that ends when you log out or
          change your password.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <Code>hydra list</Code> prints one page of functions. Filter with{" "}
            <Code>--state</Code> and <Code>--query</Code>.
          </li>
          <li>
            <Code>hydra next</Code> checks out the next open function, and{" "}
            <Code>hydra checkout</Code> takes one by name, address, or id. Both write the
            same files as the zip, plus <Code>.lease.json</Code>, which holds the lease.
          </li>
          <li>
            <Code>hydra status</Code> lists what you hold, the folder each is in, and when
            each lease runs out. <Code>hydra show</Code> prints one function&apos;s state and
            best attempt.
          </li>
          <li>
            <Code>hydra submit</Code> sends <Code>candidate.c</Code> and waits for the
            result. On a miss it shows the first byte that differs and the bytes around it.
          </li>
          <li>
            <Code>hydra refresh</Code> downloads the bundle again when types or neighbors
            changed, and keeps your <Code>candidate.c</Code>.
          </li>
          <li>
            <Code>hydra types propose</Code> sends your edited <Code>types.h</Code> as a type
            proposal, and <Code>hydra types unresolved</Code> marks a type the headers lack.
          </li>
          <li>
            <Code>hydra import</Code> uploads a Ghidra export, and{" "}
            <Code>hydra integrate</Code> runs an integration build and waits for it.
          </li>
          <li>
            <Code>hydra watch</Code> renews the lease right away and then every five
            minutes until you stop it.
          </li>
          <li>
            <Code>hydra attempts</Code> prints the history. Inside a checkout folder it
            already knows the function.
          </li>
          <li>
            <Code>hydra release</Code> gives the function back.
          </li>
        </ul>
        <p>
          Use <Code>--url</Code> to point the tool at a different site, and{" "}
          <Code>--json</Code> to get the raw response instead of a sentence.
        </p>
      </Section>

      <Section id="agent">
        <p>
          Yes. A coding agent can check out functions, write the translation, submit it,
          read where the bytes differ, and try again, using hydra under your account. Log
          hydra in with a profile token, then run <Code>hydra skill install</Code>. That
          writes a skill to <Code>~/.claude/skills/re-hydra</Code>, which tells the agent
          how to work: the loop, when to give up and release a function, and what it must
          not do. Use <Code>--project</Code> to install it for one folder only, or{" "}
          <Code>--dir</Code> for an agent that reads skills from somewhere else. For an
          agent without skills, <Code>hydra skill print</Code> prints the text to paste
          into its instructions. Run the install again after you update hydra.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Everything the agent submits is yours: it goes on your record, is released
            under CC0 like your own submissions, and the content policy applies to it as
            if you had written it.
          </li>
          <li>
            Agents do not start integration builds, import programs, or accept type
            proposals. Builds link every matched function and are costly, so hydra will
            not start one without a terminal unless a maintainer passes{" "}
            <Code>--confirm-cost</Code>.
          </li>
          <li>
            The agent follows only <Code>instructions.agent</Code> in a checkout. Every
            other file there was written by other people, and the agent is told to treat
            it as data.
          </li>
          <li>
            A token lets anything on that machine act as you. Revoke it on your profile
            when the agent is done.
          </li>
        </ul>
      </Section>

      <Section id="visibility">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="font-medium">Your profile is public:</span> your name, the
            projects you belong to, your matches, and your reputation. My work and
            Following are shown only to you.
          </li>
          <li>
            <span className="font-medium">Attempts are public:</span> anyone can see who
            tried a function, when, and the score. The byte comparison inside a miss is
            shown only to you, whoever holds the function now, and the project's owners
            and maintainers.
          </li>
          <li>
            <span className="font-medium">Your source is shared with later workers.</span>{" "}
            The best attempt on a function goes to the next person who checks it out, and
            matched source is kept as the project's result.
          </li>
          <li>
            <span className="font-medium">Discussion and activity are public.</span> The
            activity feed records checkouts, matches, and other project events.
          </li>
        </ul>
        <p>
          Reputation is your surviving matches minus regressions. A surviving match is
          one that still holds after later recipe and type changes. A regression is a
          type proposal of yours that broke matches other people had made.
        </p>
      </Section>

      <Section id="join">
        <p>
          Anyone can read a project. An owner can limit work (checkouts, submissions,
          type proposals, and discussion posts) to members. On such a project, open the
          Members tab and choose Request to join, with a short note if you like. The
          owners and maintainers see the request and can approve it, which makes you a
          contributor. If a request is declined, you can ask again after 7 days.
        </p>
        <p>
          Owners and maintainers can also add you directly. Anyone they block cannot
          work on the project, whether or not it is members-only.
        </p>
      </Section>

      <Section id="publish">
        <p>
          Start when Ghidra has finished analyzing the program. Choosing a system stores
          the public compiler from the table. You do not install the compiler yourself.
          Only import programs you have the right to share, and leave out anything that
          is not needed for matching.
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
            <span className="whitespace-nowrap">Manage Script Directories</span>, and add
            the folder that contains the script. Select <Code>ExportReHydra.java</Code>,
            run it, and save the JSON when asked. The program file has to still be at the
            path Ghidra imported it from.
            <p className="mt-2">
              The script writes one entry per defined function. External functions,
              thunks, and functions split across several address ranges are left out. To
              start with a smaller import, set <Code>MAX_FUNCTIONS</Code> at the top of
              the script to a positive number; <Code>0</Code> means every function.
            </p>
          </li>
          <li>
            Sign in and choose New project on the Projects page. The slug becomes the
            board's address, as in <Code>/projects/my-game</Code>. Choose the system, C or
            C++, and the compiler flags. <Code>-O2</Code> is the usual starting point; if
            nothing matches, the flags are the first thing to revisit. A C++ project uses
            the matching <Code>g++</Code> driver when the compiler is GCC. Nintendo 64,
            Game Boy Advance, and Saturn are C only. You become the project's owner.
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
            On the project's Settings tab, drop the JSON onto Import Ghidra export, or
            click the box and choose the file. Each function becomes an open chunk on the
            Chunks tab.
          </li>
          <li>
            Decide who may work: open to every signed-in user, or members only. This is
            under Who may work here on the Settings tab.
          </li>
        </ol>
        <p>
          Before inviting others, try matching one or two small functions yourself. If
          even simple ones miss, the compiler or flags are probably wrong, and changing
          them later reopens matches that no longer hold.
        </p>
      </Section>

      <Section id="maintain">
        <p>
          Owners and maintainers set a project's rules and fix it when something is
          stuck. Contributors check out chunks and can propose changes to shared types.
          Most controls are on the Settings, Build, and Members tabs, in the Work dialog,
          and on the Types page.
        </p>
        <ul className="list-disc space-y-3 pl-5">
          <li>
            <span className="font-medium">Compiler recipe</span> (Settings). Set the
            language and flags before matching starts. Saving a real change recompiles
            every match, and those that no longer match become stale. If one function was
            written in the other language, set Language override in its Work dialog
            instead.
          </li>
          <li>
            <span className="font-medium">Competing leases</span> (Settings). Max
            concurrent leases is how many people may work on one function at once; the
            default is 1. The first match still wins. Chunks one person may hold limits
            how many functions one account can have checked out, from 1 to 32 (default
            8).
          </li>
          <li>
            <span className="font-medium">Clear lease</span> (Work dialog). Returns a
            function to the pool when its holder has gone quiet. It is not possible while
            the function is validating.
          </li>
          <li>
            <span className="font-medium">Fuse</span> (Chunks). Join two or more open,
            stale, or matched functions from one binary that cannot be matched alone, such
            as a source function the compiler split in two. They become one chunk, and any
            existing match among them is dropped.
          </li>
          <li>
            <span className="font-medium">Types.</span> Mark a type unresolved while its
            layout is still a guess; functions that use it become blocked until you clear
            the mark. When a member proposes a change to the shared headers, start
            revalidation: every matched function is recompiled with the new headers, and
            any that miss are shown as regressions. With two or more owners and
            maintainers, a different one must accept the proposal.
          </li>
          <li>
            <span className="font-medium">Integration build</span> (Build). Once two or
            more functions match, Link N matched functions places them at their original
            addresses and compares the linked program. A function that disagrees is
            reopened, and its next checkout includes <Code>integration.txt</Code>. If the
            link itself fails, matches are left alone.
          </li>
          <li>
            <span className="font-medium">Members</span> (Members). Add people, make a
            contributor a maintainer, answer join requests, and offer ownership to another
            member. Block someone under Who may work here on Settings; their leases end at
            once.
          </li>
          <li>
            <span className="font-medium">Discussion.</span> Pin, lock, or remove
            threads, and remove any post.
          </li>
        </ul>
      </Section>
    </div>
  )
}
