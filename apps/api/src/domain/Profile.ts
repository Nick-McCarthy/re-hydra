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
  active: Schema.Boolean,
  /** The match used inline assembly (audit A-032). It does not count toward reputation. */
  usesInlineAsm: Schema.Boolean
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
  /** Surviving matches that used inline assembly. Not counted in reputation. */
  assemblyMatches: Schema.Int,
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

/** Profile phase 1: a lease the signed-in user holds, primary or competing. */
export const WorkLease = Schema.Struct({
  projectSlug: Schema.String,
  projectName: Schema.String,
  chunkId: Uuid,
  chunkName: Schema.String,
  address: Schema.String,
  kind: Schema.Literals(["primary", "competing"]),
  leaseToken: Uuid,
  leaseExpiresAt: Schema.String,
  holdStartedAt: Schema.String
}).annotate({ identifier: "WorkLease" })
export type WorkLease = typeof WorkLease.Type

/** One of the signed-in user's submissions, still being checked or finished. */
export const WorkAttempt = Schema.Struct({
  attemptId: Uuid,
  projectSlug: Schema.String,
  projectName: Schema.String,
  chunkId: Uuid,
  chunkName: Schema.String,
  createdAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  result: Schema.Literals(["checking", "matched", "missed", "compile_error"]),
  score: Schema.NullOr(Schema.Number)
}).annotate({ identifier: "WorkAttempt" })
export type WorkAttempt = typeof WorkAttempt.Type

export const MyWork = Schema.Struct({
  leases: Schema.Array(WorkLease),
  checking: Schema.Array(WorkAttempt),
  recent: Schema.Array(WorkAttempt)
}).annotate({ identifier: "MyWork" })
export type MyWork = typeof MyWork.Type

export const UserMatchesPage = Schema.Struct({
  items: Schema.Array(MatchedChunkRef),
  total: Schema.Int
}).annotate({ identifier: "UserMatchesPage" })
export type UserMatchesPage = typeof UserMatchesPage.Type

/** A project the user belongs to or has matched in. */
export const UserProjectRef = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(Schema.Literals(["owner", "maintainer", "contributor"])),
  matchCount: Schema.Int
}).annotate({ identifier: "UserProjectRef" })
export type UserProjectRef = typeof UserProjectRef.Type
