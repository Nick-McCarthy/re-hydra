# matchd seccomp profile

`matchd-seccomp.json` is Docker's default seccomp profile plus one rule, so the compile sandbox can start inside a container.

## Why

Each compile runs under bubblewrap (`MATCHD_SANDBOX=bwrap`). bwrap builds the sandbox from an unprivileged user namespace: new user, mount, pid, net, uts, and ipc namespaces, then `pivot_root` into a read-only view with one writable job directory.

Docker's default profile allows `clone` with namespace flags, `unshare`, `mount`, and `umount2` only for containers with `CAP_SYS_ADMIN`, and never allows `pivot_root`. matchd does not have `CAP_SYS_ADMIN` and should not. Under the default profile bwrap fails with `No permissions to create new namespace`, and every compile fails (audit A-027).

## What changed from upstream

One rule is appended. Everything else is upstream, byte for byte:

```json
{ "names": ["clone", "mount", "pivot_root", "umount2", "unshare"], "action": "SCMP_ACT_ALLOW" }
```

Without `CAP_SYS_ADMIN` the kernel still refuses `mount` and `unshare` of mount namespaces in the container's own namespaces. They work only inside a new user namespace. Checked on Docker Desktop 29.9.2:

- `mount -t tmpfs none /mnt` in the container: permission denied
- `unshare --mount true`: operation not permitted
- `unshare -r -m` then `mount`: works, inside the new user namespace only

The trade-off: unprivileged user namespaces expose more kernel code to a process inside the container than Docker's default does. That is the cost of a per-compile sandbox. `seccomp=unconfined` also works, but it drops every other rule in the profile, so it is not used.

`clone3` still returns `ENOSYS`, as upstream does, so libc falls back to `clone`.

## Linux hosts (AppArmor and masked /proc)

On a host with AppArmor (Ubuntu, Debian, and GitHub's runners), Docker also confines each container with its `docker-default` AppArmor profile, which denies `mount`. bwrap's mounts inside its user namespace are then refused, the self-test fails, and matchd exits. Docker Desktop has no AppArmor, so this does not show there. On such a host, also pass `--security-opt apparmor=unconfined` (CI does, through `docker-yml/docker-compose.ci.yml`), or load an AppArmor profile that allows those mounts. Ubuntu 24.04 also restricts unprivileged user namespaces on the host: `sysctl kernel.apparmor_restrict_unprivileged_userns=0`. 
Docker also masks parts of `/proc` in every container (`/proc/kcore`, `/proc/keys`, and others) by mounting over them. On GitHub's Ubuntu 24.04 runners the kernel then refuses the fresh `/proc` that bwrap mounts for the sandbox's pid namespace (`Can't mount proc on /newroot/proc: Operation not permitted`), because it would reveal the masked files. `--security-opt systempaths=unconfined` lifts the masking; CI passes it too. Docker Desktop accepts the mount without it. The alternative, binding the container's own `/proc` into the sandbox, would let a compile see matchd's processes, so it is not used.

`MATCHD_SCALE=docker` copies and the pool file do not add these options yet. A production deploy on Linux needs both.

## Where it is used

- `docker-yml/docker-compose.yml`: the `matchd` service
- `docker-yml/docker-compose.matchd-pool.yml`: every pool service, through `x-matchd-security`
- `apps/api/src/services/MatchdScaler.ts`: copies started by `MATCHD_SCALE=docker`. `MATCHD_SECCOMP_PROFILE` overrides the path.
- A production deploy must pass the same file, for example `docker run --security-opt seccomp=matchd-seccomp.json`. With `MATCHD_SANDBOX=bwrap`, matchd runs a sandbox self-test at startup and exits if the sandbox cannot start.

## Source and license

- Upstream: `seccomp/default.json` from https://github.com/moby/profiles, tag `seccomp/v0.3.0`
- Upstream sha256: `6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6`
- License: Apache License 2.0, Copyright Docker, Inc. and the Moby authors

## Regenerate

When Docker's default changes, download the new upstream file to a scratch directory, then:

```powershell
node docker-yml/make-matchd-seccomp.cjs <path to upstream default.json> docker-yml/matchd-seccomp.json
```

Update the tag and hash above.
