import { MarkdownDocument } from "@/components/markdown-document"
// One copy of the text: the page shows docs/privacy.md.
import source from "../../../../docs/privacy.md?raw"

export function PrivacyPage() {
  return <MarkdownDocument source={source} />
}
