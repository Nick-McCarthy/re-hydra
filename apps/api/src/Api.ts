import { Schema } from "effect"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema
} from "effect/http-api"
import {
  BadRequest,
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized
} from "effect/http-api/HttpApiError"
import {
  AttemptAccepted,
  AttemptSummary,
  SubmitPayload
} from "./domain/Attempt.js"
import {
  AccessTokenCreated,
  AccessTokenSummary,
  AccountRejected,
  ChangePasswordPayload,
  CreateAccessTokenPayload,
  EmailTaken,
  InvalidCredentials,
  SignInLimited,
  PasswordRejected,
  SessionCreated,
  SessionResponse,
  SignInPayload,
  SignUpPayload,
  TokenRejected,
  UserProfile
} from "./domain/Auth.js"
import {
  LeaseCreatedWithBundle,
  WorkBundle
} from "./domain/Bundle.js"
import {
  CheckoutLimited,
  ChunkState,
  ChunkSummary,
  LeaseResponse,
  SetChunkInlineAsm,
  SetChunkLanguage
} from "./domain/Chunk.js"
import {
  Integration,
  StartIntegration
} from "./domain/Integration.js"
import {
  GhidraExportPayload,
  ImportAccepted,
  ImportRejected
} from "./domain/Import.js"
import {
  FollowedProject,
  FollowState,
  ProjectEvent,
  UpdateProjectSettings,
  UserSearchHit
} from "./domain/Directory.js"
import {
  ProjectMembership,
  PublicUserProfile
} from "./domain/Profile.js"
import {
  CreateProjectPayload,
  BlockedUser,
  BlockUserPayload,
  FlagsRejected,
  ProjectAccessDenied,
  ProjectCreated,
  ProjectSummary
} from "./domain/Project.js"
import {
  CreateTypeProposalPayload,
  FusePayload,
  MarkUnresolvedPayload,
  TypeEnvironment,
  TypeProposal,
  TypeProposalCreated,
  UnresolvedMarked,
  UnresolvedType
} from "./domain/Types.js"
import { Uuid } from "./domain/Uuid.js"
import { Authorization } from "./http/Authorization.js"

const ProjectSlug = Schema.String.check(Schema.isMinLength(1)).annotate({
  identifier: "ProjectSlug"
})

const LeaseTokenPayload = Schema.Struct({
  leaseToken: Uuid
})

export const HealthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("get", "/health", {
    success: Schema.Struct({
      ok: Schema.Literal(true),
      service: Schema.Literal("re-hydra-api")
    })
  })
)

export const AuthGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.post("signUp", "/auth/sign-up", {
      payload: SignUpPayload,
      success: SessionCreated,
      error: [EmailTaken, AccountRejected]
    })
  )
  .add(
    HttpApiEndpoint.post("signIn", "/auth/sign-in", {
      payload: SignInPayload,
      success: SessionCreated,
      error: [InvalidCredentials, SignInLimited]
    })
  )
  .add(
    HttpApiEndpoint.post("changePassword", "/auth/password", {
      payload: ChangePasswordPayload,
      success: SessionResponse,
      error: [Unauthorized, PasswordRejected]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("me", "/auth/me", {
      success: UserProfile,
      error: [Unauthorized]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("logout", "/auth/logout", {
      success: HttpApiSchema.NoContent,
      error: [Unauthorized]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("createToken", "/auth/tokens", {
      payload: CreateAccessTokenPayload,
      success: AccessTokenCreated,
      error: [Unauthorized, TokenRejected]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("listTokens", "/auth/tokens", {
      success: Schema.Array(AccessTokenSummary),
      error: [Unauthorized]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.delete("revokeToken", "/auth/tokens/:tokenId", {
      params: { tokenId: Uuid },
      success: HttpApiSchema.NoContent,
      error: [Unauthorized, NotFound]
    }).middleware(Authorization)
  )

export const UsersGroup = HttpApiGroup.make("users")
  .add(
    HttpApiEndpoint.get("search", "/users", {
      query: { q: Schema.optional(Schema.String) },
      success: Schema.Array(UserSearchHit)
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/users/:userId", {
      params: { userId: Uuid },
      success: PublicUserProfile,
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("followState", "/users/:userId/follow", {
      params: { userId: Uuid },
      success: FollowState,
      error: [Unauthorized, NotFound]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("follow", "/users/:userId/follow", {
      params: { userId: Uuid },
      success: FollowState,
      error: [Unauthorized, NotFound, Conflict]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.delete("unfollow", "/users/:userId/follow", {
      params: { userId: Uuid },
      success: FollowState,
      error: [Unauthorized, NotFound, Conflict]
    }).middleware(Authorization)
  )

export const DirectoryGroup = HttpApiGroup.make("directory")
  .add(
    HttpApiEndpoint.get("feed", "/feed", {
      success: Schema.Array(ProjectEvent),
      error: [Unauthorized]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("followingUsers", "/following/users", {
      success: Schema.Array(UserSearchHit),
      error: [Unauthorized]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("followingProjects", "/following/projects", {
      success: Schema.Array(FollowedProject),
      error: [Unauthorized]
    }).middleware(Authorization)
  )

export const ProjectsGroup = HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("list", "/projects", {
      query: {
        q: Schema.optional(Schema.String),
        language: Schema.optional(Schema.String),
        arch: Schema.optional(Schema.String)
      },
      success: Schema.Array(ProjectSummary)
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/projects/:projectSlug", {
      params: { projectSlug: ProjectSlug },
      success: ProjectSummary,
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("membership", "/projects/:projectSlug/membership", {
      params: { projectSlug: ProjectSlug },
      success: ProjectMembership,
      error: [Unauthorized, NotFound]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("listBlocks", "/projects/:projectSlug/blocks", {
      params: { projectSlug: ProjectSlug },
      success: Schema.Array(BlockedUser),
      error: [Unauthorized, Forbidden, NotFound]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("block", "/projects/:projectSlug/blocks", {
      params: { projectSlug: ProjectSlug },
      payload: BlockUserPayload,
      success: Schema.Array(BlockedUser),
      error: [Unauthorized, Forbidden, NotFound, ProjectAccessDenied]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.delete("unblock", "/projects/:projectSlug/blocks/:userId", {
      params: { projectSlug: ProjectSlug, userId: Uuid },
      success: Schema.Array(BlockedUser),
      error: [Unauthorized, Forbidden, NotFound]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("create", "/projects", {
      payload: CreateProjectPayload,
      success: ProjectCreated,
      error: [Unauthorized, Conflict, NotFound, FlagsRejected]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("activity", "/projects/:projectSlug/activity", {
      params: { projectSlug: ProjectSlug },
      success: Schema.Array(ProjectEvent),
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("followState", "/projects/:projectSlug/follow", {
      params: { projectSlug: ProjectSlug },
      success: FollowState,
      error: [Unauthorized, NotFound]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("follow", "/projects/:projectSlug/follow", {
      params: { projectSlug: ProjectSlug },
      success: FollowState,
      error: [Unauthorized, NotFound]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.delete("unfollow", "/projects/:projectSlug/follow", {
      params: { projectSlug: ProjectSlug },
      success: FollowState,
      error: [Unauthorized, NotFound]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.patch("updateSettings", "/projects/:projectSlug/settings", {
      params: { projectSlug: ProjectSlug },
      payload: UpdateProjectSettings,
      success: ProjectSummary,
      error: [Unauthorized, Forbidden, NotFound, BadRequest, FlagsRejected]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("listIntegrations", "/projects/:projectSlug/integrations", {
      params: { projectSlug: ProjectSlug },
      success: Schema.Array(Integration),
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("getIntegration", "/projects/:projectSlug/integrations/:integrationId", {
      params: { projectSlug: ProjectSlug, integrationId: Uuid },
      success: Integration,
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("startIntegration", "/projects/:projectSlug/integrations", {
      params: { projectSlug: ProjectSlug },
      payload: StartIntegration,
      success: Integration,
      error: [Unauthorized, Forbidden, NotFound, BadRequest, Conflict]
    }).middleware(Authorization)
  )

export const ChunksGroup = HttpApiGroup.make("chunks")
  .add(
    HttpApiEndpoint.get("list", "/projects/:projectSlug/chunks", {
      params: { projectSlug: ProjectSlug },
      query: {
        state: Schema.optional(ChunkState),
        q: Schema.optional(Schema.String),
        limit: Schema.optional(
          Schema.NumberFromString.check(Schema.isInt())
            .check(Schema.isGreaterThanOrEqualTo(1))
            .check(Schema.isLessThanOrEqualTo(500))
        ),
        offset: Schema.optional(
          Schema.NumberFromString.check(Schema.isInt())
            .check(Schema.isGreaterThanOrEqualTo(0))
        )
      },
      success: Schema.Array(ChunkSummary),
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/projects/:projectSlug/chunks/:chunkId", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      success: ChunkSummary,
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("bundle", "/projects/:projectSlug/chunks/:chunkId/bundle", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      success: WorkBundle,
      error: [Unauthorized, NotFound, Conflict]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("checkout", "/projects/:projectSlug/chunks/:chunkId/checkout", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      success: LeaseCreatedWithBundle,
      error: [Unauthorized, NotFound, Conflict, CheckoutLimited, ProjectAccessDenied]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("release", "/projects/:projectSlug/chunks/:chunkId/release", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      payload: LeaseTokenPayload,
      success: ChunkSummary,
      error: [Unauthorized, NotFound, Conflict]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("heartbeat", "/projects/:projectSlug/chunks/:chunkId/heartbeat", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      payload: LeaseTokenPayload,
      success: LeaseResponse,
      error: [Unauthorized, NotFound, Conflict, ProjectAccessDenied]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("submit", "/projects/:projectSlug/chunks/:chunkId/submit", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      payload: SubmitPayload,
      success: AttemptAccepted,
      error: [Unauthorized, NotFound, Conflict, ProjectAccessDenied]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("listAttempts", "/projects/:projectSlug/chunks/:chunkId/attempts", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      success: Schema.Array(AttemptSummary),
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.put("setLanguage", "/projects/:projectSlug/chunks/:chunkId/language", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      payload: SetChunkLanguage,
      success: ChunkSummary,
      error: [Unauthorized, Forbidden, NotFound, Conflict]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.put("setInlineAsm", "/projects/:projectSlug/chunks/:chunkId/inline-asm", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      payload: SetChunkInlineAsm,
      success: ChunkSummary,
      error: [Unauthorized, Forbidden, NotFound, Conflict]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("clearLease", "/projects/:projectSlug/chunks/:chunkId/clear", {
      params: {
        projectSlug: ProjectSlug,
        chunkId: Uuid
      },
      success: ChunkSummary,
      error: [Unauthorized, Forbidden, NotFound, Conflict]
    }).middleware(Authorization)
  )

export const ImportsGroup = HttpApiGroup.make("imports").add(
  HttpApiEndpoint.post("create", "/projects/:projectSlug/imports", {
    params: { projectSlug: ProjectSlug },
    payload: GhidraExportPayload,
    success: ImportAccepted,
    error: [Unauthorized, Forbidden, NotFound, BadRequest, ImportRejected, Conflict]
  }).middleware(Authorization)
)

export const TypesGroup = HttpApiGroup.make("types")
  .add(
    HttpApiEndpoint.get("getEnvironment", "/projects/:projectSlug/type-environment", {
      params: { projectSlug: ProjectSlug },
      success: TypeEnvironment,
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("listProposals", "/projects/:projectSlug/type-proposals", {
      params: { projectSlug: ProjectSlug },
      success: Schema.Array(TypeProposal),
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get("getProposal", "/projects/:projectSlug/type-proposals/:proposalId", {
      params: { projectSlug: ProjectSlug, proposalId: Uuid },
      success: TypeProposal,
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("createProposal", "/projects/:projectSlug/type-proposals", {
      params: { projectSlug: ProjectSlug },
      payload: CreateTypeProposalPayload,
      success: TypeProposalCreated,
      error: [Unauthorized, Forbidden, NotFound, Conflict, ProjectAccessDenied]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post(
      "startRevalidation",
      "/projects/:projectSlug/type-proposals/:proposalId/revalidate",
      {
        params: { projectSlug: ProjectSlug, proposalId: Uuid },
        success: TypeProposal,
        error: [Unauthorized, Forbidden, NotFound, Conflict]
      }
    ).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post(
      "acceptProposal",
      "/projects/:projectSlug/type-proposals/:proposalId/accept",
      {
        params: { projectSlug: ProjectSlug, proposalId: Uuid },
        success: TypeProposal,
        error: [Unauthorized, Forbidden, NotFound, Conflict]
      }
    ).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.get("listUnresolved", "/projects/:projectSlug/unresolved-types", {
      params: { projectSlug: ProjectSlug },
      success: Schema.Array(UnresolvedType),
      error: [NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("markUnresolved", "/projects/:projectSlug/unresolved-types", {
      params: { projectSlug: ProjectSlug },
      payload: MarkUnresolvedPayload,
      success: UnresolvedMarked,
      error: [Unauthorized, Forbidden, NotFound, Conflict]
    }).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post(
      "clearUnresolved",
      "/projects/:projectSlug/unresolved-types/:typeName/clear",
      {
        params: {
          projectSlug: ProjectSlug,
          typeName: Schema.String.check(Schema.isMinLength(1))
        },
        success: UnresolvedType,
        error: [Unauthorized, Forbidden, NotFound, Conflict]
      }
    ).middleware(Authorization)
  )
  .add(
    HttpApiEndpoint.post("fuse", "/projects/:projectSlug/fuse", {
      params: { projectSlug: ProjectSlug },
      payload: FusePayload,
      success: ChunkSummary.pipe(HttpApiSchema.status("Created")),
      error: [Unauthorized, Forbidden, NotFound, BadRequest, Conflict]
    }).middleware(Authorization)
  )

export const Api = HttpApi.make("re-hydra-api")
  .add(HealthGroup)
  .add(AuthGroup)
  .add(UsersGroup)
  .add(DirectoryGroup)
  .add(ProjectsGroup)
  .add(ChunksGroup)
  .add(ImportsGroup)
  .add(TypesGroup)
  .prefix("/v1")
