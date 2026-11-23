// Builds docker-yml/matchd-seccomp.json from Moby's default seccomp profile.
// Usage: node docker-yml/make-matchd-seccomp.cjs <upstream default.json> docker-yml/matchd-seccomp.json
// See docker-yml/matchd-seccomp.md for where the upstream file comes from.
const fs = require("fs")
const [src, out] = process.argv.slice(2)
const profile = JSON.parse(fs.readFileSync(src, "utf8"))
if (profile.defaultAction !== "SCMP_ACT_ERRNO") throw new Error("unexpected upstream defaultAction")

profile.syscalls.push({
  names: ["clone", "mount", "pivot_root", "umount2", "unshare"],
  action: "SCMP_ACT_ALLOW",
  comment:
    "re-hydra matchd: bwrap builds each compile sandbox from an unprivileged user namespace " +
    "(new user, mount, pid, net, uts, and ipc namespaces, then pivot_root into a read-only view). " +
    "Docker's default allows these only with CAP_SYS_ADMIN, which matchd does not have. " +
    "Without CAP_SYS_ADMIN the kernel still refuses mount and pivot_root in the container's own namespaces; " +
    "they succeed only inside the new user namespace. clone3 stays ENOSYS as upstream, so libc falls back to clone."
})

fs.writeFileSync(out, JSON.stringify(profile, null, "\t") + "\n")
console.log(`wrote ${out}: ${profile.syscalls.length} rule groups`)
