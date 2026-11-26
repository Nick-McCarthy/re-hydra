import { MarkdownDocument } from "@/components/markdown-document"
// One copy of the text: the page shows docs/policy/terms.md.
import source from "../../../../docs/policy/terms.md?raw"

export function TermsPage() {
  return <MarkdownDocument source={source} />
}
