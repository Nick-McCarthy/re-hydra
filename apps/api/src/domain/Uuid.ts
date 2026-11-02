import { Schema } from "effect"

/** UUID string validated with RFC version/variant bits. */
export const Uuid = Schema.String.check(Schema.isUUID()).annotate({
  identifier: "Uuid",
  description: "RFC UUID"
})

export type Uuid = typeof Uuid.Type
