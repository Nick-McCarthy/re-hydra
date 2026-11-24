# @re-hydra/matchd

Compile + normalized instruction compare, plus a link step that places matched functions at their original addresses. The API is the only client (service bearer token).

Prefer `docker compose up -d matchd` on Windows. The image includes gcc, g++, and binutils. See `docs/roadmap.md`.

## Local

Needs `gcc` and `objdump` on PATH (Linux/macOS/WSL), or run via Docker:

```bash
# from repo root
docker compose up -d matchd
# or without docker tools on the host:
npm run matchd
```

- Health: http://localhost:3001/v1/health
- Docs: http://localhost:3001/docs
- Auth: `Authorization: Bearer <MATCHD_TOKEN>`. `MATCHD_TOKEN` is required and has no default. The images do not set it. Local compose and `.env.example` use `dev-matchd-token`, which logs a warning at startup. For host `npm run matchd`, copy `apps/matchd/.env.example` to `apps/matchd/.env`

## Job

`POST /v1/jobs`

```json
{
  "jobId": "…",
  "arch": "x86_64",
  "toolchain": { "compiler": "gcc", "version": "…", "flags": ["-O2"], "image": "…" },
  "entrySymbol": "parse_header",
  "originalBytesBase64": "…",
  "sources": [
    { "path": "candidate.c", "text": "…" },
    { "path": "types.h", "text": "…" }
  ]
}
```

`language` is `c` (default, `gcc`, `candidate.c`) or `cpp` (`g++`, `candidate.cpp`). C++ symbols may be Itanium-mangled; matchd resolves them back to the chunk name.

Compiles with `-c` inside the image sandbox (`MATCHD_SANDBOX=bwrap`): no network, a read-only toolchain, and a private temp directory so one job cannot read another. The wall clock cap is 30 seconds, CPU time is 30 seconds, and an output file stops at 32 MiB. A function source stops at 256 KiB. `types.h` stops at 2 MiB. Host `npm run matchd` leaves `MATCHD_SANDBOX` off. The match takes the symbol's bytes from `objdump -d -r` and `nm -S`, blanks relocation fields on both sides, and compares what remains. Opcodes are never blanked, so `add` and `and` cannot compare equal. A linked call displacement is blanked, so an isolated call can match. An unknown relocation type fails closed. `matched` is true only when the masked sequences have the same length and the same bytes.

`toolchainDigest` is `sha256:v2:` plus the hashes of `cc1` or `cc1plus`, `as`, and the recipe flags. `expectedToolchainDigest` on a job refuses the compile when those binaries differ. An older `sha256:` digest is not a pin. A different recipe with the same binaries is allowed and returns a new digest.

## Link job

`POST /v1/link-jobs`

Same auth. Body is `language`, `headers`, and `units[]` of `{ symbol, address, size, originalBytesBase64, source }`. Each unit is compiled alone with `-ffunction-sections`, then `ld` places `.text.<symbol>` at `address`. The section has to be the same length as the original range, and those bytes have to match. A longer section fails even when the original bytes are a prefix. `compilerOk` is false when the compiler or the link itself fails. A unit with `passed: false` is the chunk to reopen. Unresolved calls are left unresolved so one missing callee does not fail the link.

## Pinned sources

Every image is built from pinned inputs, so two builds of the same commit use the same base and the same downloads (audit A-039):

- `FROM node:22-bookworm-slim@sha256:…` and `node:22-trixie-slim@sha256:…`. To move to a newer base, pull the tag and read its digest with `docker image inspect node:22-bookworm-slim --format '{{index .RepoDigests 0}}'`, then update every Dockerfile.
- `Dockerfile.n64` checks the GCC 2.8.1 tarball's sha256.
- `Dockerfile.psp` checks the pspdev tarball's sha256.
- `Dockerfile.mwcc` installs rustup-init 1.29.3, checked against its published sha256, and Rust 1.100.0.
- Git sources (agbcc, mwcc-rs) are fixed by commit.

Debian packages from `apt-get` are not pinned. A rebuild can pick up newer compiler packages, which changes the toolchain digest recorded on matches. That is how the digest is meant to work: a recheck against a different binary is refused.
