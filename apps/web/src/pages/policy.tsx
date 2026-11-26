import { Link } from "react-router-dom"
import { MarkdownDocument } from "@/components/markdown-document"
// One copy of the text: the page shows the document in docs/, sections 1–5.
// Section 6 is the build checklist and stays out of the public page.
import policySource from "../../../../docs/content-policy.md?raw"

const publicPart = (source: string) => {
  const end = source.search(/^## 6./m)
  return end === -1 ? source : source.slice(0, end)
}

const policyText = publicPart(policySource)

export function PolicyPage() {
  return (
    <MarkdownDocument source={policyText}>
      <p className="pt-4 text-muted-foreground">
        To report a project, a function, or a post, use the Report button on it. <Link to="/faq" className="underline underline-offset-2">FAQ</Link>
      </p>
    </MarkdownDocument>
  )
}
