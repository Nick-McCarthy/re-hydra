import { MarkdownDocument } from "@/components/markdown-document"
// One copy of the text: the page shows docs/policy/privacy.md.
import source from "../../../../docs/policy/privacy.md?raw"

export function PrivacyPage() {
  return <MarkdownDocument source={source} />
}
