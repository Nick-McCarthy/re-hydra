import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { createServer } from "node:http"
import { Api } from "./Api.js"
import { SqlLive } from "./db/SqlLive.js"
import { AuthLive } from "./http/AuthLive.js"
import { AuthorizationLive } from "./http/AuthorizationLive.js"
import { ChunksLive } from "./http/ChunksLive.js"
import { HealthLive } from "./http/HealthLive.js"
import { ImportsLive } from "./http/ImportsLive.js"
import { ProjectsLive } from "./http/ProjectsLive.js"
import { TypesLive } from "./http/TypesLive.js"
import { DirectoryLive, UsersLive } from "./http/UsersLive.js"
import { EdgeMiddlewareLive } from "./http/EdgeMiddleware.js"
import { Activity } from "./services/Activity.js"
import { AttemptsRepo } from "./services/AttemptsRepo.js"
import { AuthRepo } from "./services/AuthRepo.js"
import { Blobs } from "./services/Blobs.js"
import { ChunksRepo } from "./services/ChunksRepo.js"
import { FuseRepo } from "./services/FuseRepo.js"
import { ImportsRepo } from "./services/ImportsRepo.js"
import { LeaseSweeperLive } from "./services/LeaseSweeper.js"
import { MatchdClient } from "./services/MatchdClient.js"
import { MatchdPool } from "./services/MatchdPool.js"
import { MatchdScalerLive } from "./services/MatchdScaler.js"
import { IntegrationWorkerLive } from "./services/IntegrationWorker.js"
import { IntegrationsRepo } from "./services/IntegrationsRepo.js"
import { MatchWorkerLive } from "./services/MatchWorker.js"
import { ProjectAuth } from "./services/ProjectAuth.js"
import { ProjectChunkStats } from "./services/ProjectChunkStats.js"
import { RateLimits } from "./services/RateLimits.js"
import { DirectoryRepo } from "./services/DirectoryRepo.js"
import { ProjectsRepo } from "./services/ProjectsRepo.js"
import { ProjectModeration } from "./services/ProjectModeration.js"
import { TypeProposalsRepo } from "./services/TypeProposalsRepo.js"
import { UnresolvedTypesRepo } from "./services/UnresolvedTypesRepo.js"
import { UsersRepo } from "./services/UsersRepo.js"
import { WorkBundles } from "./services/WorkBundles.js"

const BlobsLive = Blobs.layer
const Authz = ProjectAuth.layer

const StatsLive = ProjectChunkStats.layer
const ActivityLive = Activity.layer
const ChunksLiveLayer = ChunksRepo.layer.pipe(
  Layer.provide(StatsLive),
  Layer.provide(Authz),
  Layer.provide(ActivityLive)
)

const DataLive = Layer.mergeAll(
  StatsLive,
  Authz,
  ActivityLive,
  ChunksLiveLayer,
  ProjectsRepo.layer.pipe(Layer.provide(ActivityLive)),
  UsersRepo.layer,
  DirectoryRepo.layer,
  AttemptsRepo.layer.pipe(
    Layer.provide(BlobsLive),
    Layer.provide(StatsLive),
    Layer.provide(Authz)
  ),
  ProjectModeration.layer.pipe(
    Layer.provide(Authz),
    Layer.provide(ActivityLive),
    Layer.provide(StatsLive)
  ),
  ImportsRepo.layer.pipe(
    Layer.provide(BlobsLive),
    Layer.provide(StatsLive),
    Layer.provide(ActivityLive)
  ),
  WorkBundles.layer.pipe(
    Layer.provide(ChunksLiveLayer),
    Layer.provide(BlobsLive)
  ),
  TypeProposalsRepo.layer.pipe(
    Layer.provide(Authz),
    Layer.provide(BlobsLive),
    Layer.provide(ActivityLive)
  ),
  UnresolvedTypesRepo.layer.pipe(
    Layer.provide(Authz),
    Layer.provide(StatsLive),
    Layer.provide(ActivityLive)
  ),
  IntegrationsRepo.layer.pipe(
    Layer.provide(Authz),
    Layer.provide(ActivityLive)
  ),
  FuseRepo.layer.pipe(
    Layer.provide(Authz),
    Layer.provide(BlobsLive),
    Layer.provide(StatsLive),
    Layer.provide(ActivityLive)
  ),
  BlobsLive,
  RateLimits.layer,
  AuthRepo.layer.pipe(Layer.provide(RateLimits.layer)),
  Layer.provideMerge(MatchdClient.layer, MatchdPool.layer)
).pipe(Layer.provide(SqlLive))

const ApiHandlers = Layer.mergeAll(
  HealthLive,
  AuthLive,
  UsersLive,
  DirectoryLive,
  ProjectsLive,
  ChunksLive,
  ImportsLive,
  TypesLive
).pipe(
  Layer.provide(DataLive),
  Layer.provide(SqlLive)
)

const WorkersLive = Layer.mergeAll(
  MatchWorkerLive,
  IntegrationWorkerLive,
  LeaseSweeperLive,
  MatchdScalerLive
).pipe(
  Layer.provide(DataLive),
  Layer.provide(SqlLive)
)

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(ApiHandlers),
  Layer.provide(AuthorizationLive.pipe(Layer.provide(DataLive))),
  Layer.provide(HttpApiScalar.layer(Api))
)

// EdgeMiddlewareLive is global: rate limits and body-size caps on every route
// (audit A-034, A-035).
const HttpLive = HttpRouter.serve(
  Layer.mergeAll(ApiLive, WorkersLive, EdgeMiddlewareLive)
).pipe(
  Layer.provide(DataLive),
  Layer.provide(SqlLive),
  Layer.provide(
    NodeHttpServer.layerConfig(createServer, {
      port: Config.Port("API_PORT").pipe(Config.withDefault(3000))
    })
  )
)

NodeRuntime.runMain(Layer.launch(HttpLive))
