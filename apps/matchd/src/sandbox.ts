import * as path from "node:path"

/** One function. A project-wide types.h uses the larger cap. */
export const maxFunctionSourceBytes = 256 * 1024
export const maxHeadersBytes = 2 * 1024 * 1024
/** Object files and assembler temps. prlimit enforces this inside the sandbox. */
export const maxOutputBytes = 32 * 1024 * 1024

const fallbackPath = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

export const isJobDir = (cwd: string): boolean => {
  const base = path.basename(cwd)
  return base.startsWith("rehydra-match-") || base.startsWith("rehydra-link-")
}

/**
 * Args after `bwrap`. The root stays read-only. A job directory is the only
 * writable path, and it is the only temp directory mounted, so another job's
 * files are not visible. The network namespace is empty. MATCHD_TOKEN is not
 * copied in. Toolchain variables are, because the GBA and GameCube drivers
 * read them.
 */
export const sandboxArgv = (
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  parentEnv: NodeJS.ProcessEnv
): Array<string> => {
  const abs = path.resolve(cwd)
  const argv = [
    "--unshare-user",
    "--unshare-net",
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-ipc",
    "--uid",
    "0",
    "--gid",
    "0",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--ro-bind",
    "/",
    "/",
    "--tmpfs",
    "/tmp",
    "--dev",
    "/dev",
    "--proc",
    "/proc"
  ]
  if (isJobDir(abs)) {
    argv.push("--bind", abs, abs)
  }
  argv.push("--chdir", abs, "--clearenv")
  argv.push("--setenv", "PATH", parentEnv.PATH && parentEnv.PATH.length > 0 ? parentEnv.PATH : fallbackPath)
  argv.push("--setenv", "HOME", "/tmp")
  argv.push("--setenv", "TMPDIR", "/tmp")
  if (parentEnv.PSPDEV !== undefined && parentEnv.PSPDEV.length > 0) {
    argv.push("--setenv", "PSPDEV", parentEnv.PSPDEV)
  }
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value === undefined) continue
    if (!key.startsWith("MATCHD_")) continue
    if (key === "MATCHD_TOKEN" || key === "MATCHD_SANDBOX") continue
    argv.push("--setenv", key, value)
  }
  argv.push("--", cmd, ...args)
  return argv
}

export const sandboxedSpawn = (
  cmd: string,
  args: ReadonlyArray<string>,
  cwd: string,
  parentEnv: NodeJS.ProcessEnv
): {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env: { readonly PATH: string }
} => ({
  command: "prlimit",
  args: [
    "--cpu=30",
    `--fsize=${maxOutputBytes}`,
    "--nproc=128",
    "--nofile=256",
    "--",
    "bwrap",
    ...sandboxArgv(cmd, args, cwd, parentEnv)
  ],
  env: { PATH: parentEnv.PATH && parentEnv.PATH.length > 0 ? parentEnv.PATH : fallbackPath }
})
