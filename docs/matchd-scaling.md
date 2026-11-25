# matchd: scaling, capacity, and cost

Measured on 2026-11-24 on a 16-thread desktop (Docker Desktop, 16 CPUs, 8 GB), with a real 15-line C function per job. Costs are rough list prices from memory. Check them before you budget.

## Summary

- **Compiling is cheap.** A GCC or Clang match job uses about 0.2 CPU-seconds. All the compiles for a 10,000-function game come to about 15 CPU-hours spread over the project's life, which is under a dollar of compute.
- **What costs money is keeping things running**, not the jobs: 18 warm compiler images, Postgres, and the API. One 8-core, 32 GB machine can carry the whole site for a long time.
- **What breaks first under load** is not raw CPU:
  1. One matchd container tops out around 16 jobs/s while using only about 3 cores. More throughput means more copies of the container, not a bigger machine.
  2. The first integration build of a large project still takes minutes. Later builds reuse every unchanged function and take seconds.
- **Fixed on 2026-11-25:** integration builds compile units in parallel and cache each compiled unit. A 200-function rebuild with one change went from 23 s to 0.4 s.
- **Fixed on 2026-11-24:**
  - A long integration build is no longer claimed and run a second time. The claimer renews its claim every 30 s, and writes its result only while it still holds the claim (migration 021, `verify-integration-claim.mjs`).
  - GBA and GameCube jobs were 8× slower than the rest because their compiler wrappers started through `npx tsx`. The wrappers are now bundled to plain JS, and those jobs run as fast as GCC.

## How a job flows

A submit inserts a `jobs` row. Each API process runs `MATCHD_WORKERS` (4) claimers, which take jobs from Postgres with `FOR UPDATE SKIP LOCKED` and post them to the matchd process for that image (`MATCHD_ROUTES`). matchd itself has no concurrency limit, so the claimers set it: 4 jobs in flight per API process. Each job runs a handful of sandboxed processes (inline-asm scan, compile, nm, objdump) with a 30 s cap per process and a 1 GB data cap. `MATCHD_SCALE=docker` adds up to 4 local copies of an image once an interactive job has waited 30 s.

The GBA compiler being fetched from GitHub only happens when the image is **built**. Once the image is in a registry, a new GBA node starts as fast as any other: one image pull (0.9–1.9 GB) and about 10 s to boot.

## Measurements

Match jobs, one container per image, N jobs in flight:

| Image | 1 in flight | 4 | 8 | 16 | CPU per job |
| --- | --- | --- | --- | --- | --- |
| host gcc | 150 ms, 6.6/s | 260 ms, 15.5/s | 480 ms, 16.0/s | 940 ms, 16.6/s | ~0.18 core-s |
| ps2 gcc | 145 ms, 6.9/s | 250 ms, 15.6/s | 460 ms, 16.9/s | 910 ms, 16.8/s | ~0.18 core-s |
| switch clang | 180 ms, 5.6/s | 200 ms, 20.1/s | 265 ms, 30.0/s | 495 ms, 32.0/s | lower |
| gba agbcc | 144 ms, 6.9/s | 187 ms, 20.9/s | 291 ms, 27.4/s | 544 ms, 27.7/s | ~0.13 core-s |
| gamecube mwcc | 141 ms, 7.1/s | 203 ms, 19.8/s | 317 ms, 24.7/s | 602 ms, 25.9/s | similar |
| gba agbcc, before the wrapper fix | 1140 ms, 0.9/s | 1300 ms, 3.1/s | 1710 ms, 4.6/s | 2860 ms, 5.6/s | ~2.7 core-s |

Each cell is median latency, then throughput. GameCube before the fix was the same as GBA.

- At 16 in flight, the ps2 container used 2.8 cores and the GBA container 3.4 (14.5 before the fix). In both cases the limit is inside the matchd process, not the CPU.
- Before the fix, `agbcc-cc` and `mwcc-cc` started through `npx tsx`, which took **about 460 ms per call**, while the agbcc compiler itself takes 1 ms. A job calls the wrapper more than once.
- Memory: about 250–290 MB per idle warm image. GBA reached 790 MB with 16 jobs in flight. All 18 images warm need about 5 GB before any work arrives.
- Integration build (host gcc, one link job): **about 117 ms per function, one after another**. 50 units took 5.9 s and 200 took 23.4 s.

## How much work a chunk creates

These are assumptions, not measurements. Change them as real usage arrives.

| Work | Jobs |
| --- | --- |
| Submits until a function matches | 20–50 (assume 30) |
| An active contributor while working | about 1 submit every 2 minutes |
| A type proposal | one job per matched chunk it touches (hundreds to thousands) |
| A recipe change | one job per current match in the project |
| An integration build | one link job holding every matched function |

| Game size | Functions | Match jobs over the project's life | CPU (GCC) |
| --- | --- | --- | --- |
| GBA / N64 / Genesis | 3k–15k | 90k–450k | 5–23 core-hours |
| GameCube / PS2 / PSP | 20k–60k | 600k–1.8M | 30–90 core-hours |
| PS3 / Switch | 50k–200k+ | 1.5M–6M | 75–300 core-hours |

## Capacity

**Interactive submits.** 1,000 people working at the same moment make about 8 jobs/s. That fits in one container, and one 8-vCPU machine (CPU-bound at about 40 jobs/s, given 3 copies per image) can take roughly 4,000 active contributors. That now includes GBA and GameCube.

**Batch work** is where the queue fills up:

- A recipe change on a 10k-match project is 10k jobs, run one at a time by a single worker: about 25 minutes.
- A type proposal touching 2,000 matched chunks takes about 2 minutes. These run at low priority behind interactive submits, so contributors don't notice them, but they compete for the same containers.

**Integration builds** do not scale yet:

Measured on host gcc, one container:

| Build | Before | First build now | Rebuild, cache warm |
| --- | --- | --- | --- |
| 200 functions | 23 s | 7.8 s | 0.3 s (0.4 s with one changed) |
| 1,000 functions | ~2 min (est.) | 41 s | 4.3 s |
| 10,000 functions | ~20 min (est.) | ~7 min (est.) | under a minute (est.) |

Units compile side by side (`MATCHD_LINK_CONCURRENCY`, default the CPU count up to 8). The first build gains only about 3× from that, because it hits the same per-container ceiling as match jobs. Each compiled unit is cached on disk (`MATCHD_LINK_CACHE_DIR`, `MATCHD_LINK_CACHE_MB`, default 1 GB, least recently used dropped first). The key is a hash of the target, compiler digest, language, flags, type headers, symbol and source. The address is not part of it, because placement happens at link time. A cached unit still goes through the inline-assembly rule for its chunk, and the link and compare always run in full.

The key also carries a build ID: a hash of matchd's own `src/`, computed at startup (`MATCHD_BUILD_ID` overrides it). A cached unit holds matchd's reading of the object, so new matchd code starts a fresh cache instead of trusting an older reading. That makes it safe to keep the cache directory on a volume. By default the cache lives in the container, so a restart or a different copy of the image starts cold. With a shared volume, copies built from the same source share entries, and their writes are atomic. A change to the type headers misses on every unit, because the headers shape every object. The API used to reclaim a `running` integration after 2 minutes, so with more than one API process a long build was started again while the first copy still ran. Now the claimer renews `claimed_at` every 30 s (`INTEGRATION_HEARTBEAT_SECONDS`), and the build is reclaimed only after 120 s without a renewal (`INTEGRATION_RECLAIM_SECONDS`). Each claim carries a `claim_token`, so a worker that lost its claim writes nothing.

## Cost

Prices are approximate on-demand list prices for us-east-1 and Hetzner, from memory.

| Stage | Load | Setup | AWS / month | Hetzner / month |
| --- | --- | --- | --- | --- |
| Launch | under 100 active at once, a few projects | one 8 vCPU / 32 GB box: all warm images, API, Postgres | ~$300 (m7i.2xlarge), ~$120 with a 1-year commitment | ~€50–70 (AX42 or CCX33) |
| Growing | hundreds active, tens of projects | managed Postgres, 2 small API nodes, matchd pool of 2 × 8–16 vCPU, spot for batch | ~$700–1,200 | ~€200–350 |
| Large | thousands active, daily integration builds of big games | 3+ matchd nodes with autoscaling, a bigger DB, a second site | ~$2,000–4,000 | ~€600–1,200 |

Smaller items: object storage for imports (tens of GB, a few dollars), an image registry (18 images, about 25 GB, a few dollars), and egress (small, since jobs are kilobytes).

**Per chunk:** 30 jobs × 0.18 core-s is about 5 CPU-seconds, a fraction of a cent. Hosting cost tracks how many images are warm and how many machines run, not how many chunks get done.

## What to fix, in order

1. ~~Integration build heartbeat.~~ Done.
2. ~~Faster GBA and GameCube wrappers.~~ Done: about 8× faster and 20× less CPU per job.
3. ~~Parallel and incremental integration builds.~~ Done. A shared cache volume, or sending builds for a project to the same container, would keep the cache warm across copies.
4. **A per-container ceiling.** Find what holds a GCC container at about 16 jobs/s with idle cores (likely spawning on Node's single thread), or run 2–3 copies per busy image by default.
5. **A production scaler.** `MATCHD_SCALE=docker` covers one machine. Hosting needs the same rule (scale an image when interactive wait passes 30 s, keep one warm copy) on ECS, Nomad or Kubernetes, with batch work on spot capacity.
6. **Cold images.** Rarely used images (Xbox, Saturn) could start on demand instead of staying warm, which saves about 250 MB each. A first submit then waits about 10 s plus the image pull.
