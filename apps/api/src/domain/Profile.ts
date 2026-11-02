import { Schema } from "effect"
import { Uuid } from "./Uuid.js"

export const MatchedChunkRef = Schema.Struct({
  matchId: Uuid,
  chunkId: Uuid,
  projectSlug: Schema.String,
  projectName: Schema.String,
  chunkName: Schema.String,
  address: Schema.String,
  language: Schema.String,
  createdAt: Schema.String,
  active: Schema.Boolean
}).annotate({ identifier: "MatchedChunkRef" })

export type MatchedChunkRef = typeof MatchedChunkRef.Type

export const MaintainedProjectRef = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  role: Schema.Literals(["owner", "maintainer"])
}).annotate({ identifier: "MaintainedProjectRef" })

export type MaintainedProjectRef = typeof MaintainedProjectRef.Type

export const PublicUserProfile = Schema.Struct({
  id: Uuid,
  displayName: Schema.String,
  createdAt: Schema.String,
  matchedCount: Schema.Int,
  survivingMatches: Schema.Int,
  regressions: Schema.Int,
  reputation: Schema.Int,
  followerCount: Schema.Int,
  followingCount: Schema.Int,
  matchedChunks: Schema.Array(MatchedChunkRef),
  projects: Schema.Array(MaintainedProjectRef)
}).annotate({ identifier: "PublicUserProfile" })

export type PublicUserProfile = typeof PublicUserProfile.Type

export const ProjectMembership = Schema.Struct({
  projectSlug: Schema.String,
  role: Schema.Literals(["owner", "maintainer", "contributor"])
}).annotate({ identifier: "ProjectMembership" })

export type ProjectMembership = typeof ProjectMembership.Type
