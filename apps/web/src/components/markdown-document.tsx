import * as React from "react"

// Renders the documents in docs/ (content policy, privacy, terms) so each has one copy.

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: Array<string> }
  | { kind: "quote"; lines: Array<string> }
  | { kind: "table"; head: Array<string>; rows: Array<Array<string>> }
  | { kind: "rule" }

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())

/** The small part of Markdown the policy uses. */
function parse(source: string): Array<Block> {
  const lines = source.replace(/\r\n/g, "\n").split("\n")
  const blocks: Array<Block> = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ""
    if (line.trim() === "") {
      i++
    } else if (/^---+$/.test(line.trim())) {
      blocks.push({ kind: "rule" })
      i++
    } else if (/^#{1,3} /.test(line)) {
      const level = line.indexOf(" ") as 1 | 2 | 3
      blocks.push({ kind: "heading", level, text: line.slice(level + 1) })
      i++
    } else if (line.startsWith("|")) {
      const head = cells(line)
      const rows: Array<Array<string>> = []
      i += 2 // header and separator
      while (i < lines.length && (lines[i] ?? "").startsWith("|")) rows.push(cells(lines[i++] ?? ""))
      blocks.push({ kind: "table", head, rows })
    } else if (line.startsWith(">")) {
      const quoted: Array<string> = []
      while (i < lines.length && (lines[i] ?? "").startsWith(">")) quoted.push((lines[i++] ?? "").replace(/^>\s?/, ""))
      blocks.push({ kind: "quote", lines: quoted })
    } else if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line)
      const items: Array<string> = []
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i] ?? "")) items.push((lines[i++] ?? "").replace(/^(- |\d+\. )/, ""))
      blocks.push({ kind: "list", ordered, items })
    } else {
      const text: Array<string> = []
      while (i < lines.length && (lines[i] ?? "").trim() !== "" && !/^(#|\||>|- |\d+\. |---)/.test(lines[i] ?? "")) {
        text.push(lines[i++] ?? "")
      }
      blocks.push({ kind: "paragraph", text: text.join(" ") })
    }
  }
  return blocks
}

/** **bold** and `code`. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : part.startsWith("`") && part.endsWith("`") ? (
          <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

export function MarkdownDocument({ source, children }: { source: string; children?: React.ReactNode }) {
  const blocks = React.useMemo(() => parse(source), [source])
  return (
    <article className="mx-auto max-w-3xl space-y-4 text-sm leading-6">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return block.level === 1 ? (
              <h1 key={index} className="text-2xl font-semibold tracking-tight">
                <Inline text={block.text} />
              </h1>
            ) : block.level === 2 ? (
              <h2 key={index} id={block.text.match(/^(\d+)\./)?.[1]} className="pt-4 text-lg font-semibold tracking-tight">
                <Inline text={block.text} />
              </h2>
            ) : (
              <h3 key={index} className="pt-2 font-semibold">
                <Inline text={block.text} />
              </h3>
            )
          case "paragraph":
            return (
              <p key={index}>
                <Inline text={block.text} />
              </p>
            )
          case "list": {
            const items = block.items.map((item, n) => (
              <li key={n}>
                <Inline text={item} />
              </li>
            ))
            return block.ordered ? (
              <ol key={index} className="list-decimal space-y-1 pl-6">
                {items}
              </ol>
            ) : (
              <ul key={index} className="list-disc space-y-1 pl-6">
                {items}
              </ul>
            )
          }
          case "quote":
            return (
              <blockquote key={index} className="border-l-2 pl-4 text-muted-foreground">
                {block.lines.map((line, n) => (
                  <div key={n}>
                    <Inline text={line} />
                  </div>
                ))}
              </blockquote>
            )
          case "table":
            return (
              <div key={index} className="overflow-x-auto rounded-md border">
                <table className="w-full text-left">
                  <thead className="bg-muted/50">
                    <tr>
                      {block.head.map((cell, n) => (
                        <th key={n} className="px-3 py-2 font-medium">
                          <Inline text={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-t align-top">
                        {row.map((cell, n) => (
                          <td key={n} className="px-3 py-2">
                            <Inline text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case "rule":
            return <hr key={index} />
        }
      })}
      {children}
    </article>
  )
}
