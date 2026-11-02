const token = process.argv[2]
if (!token) throw new Error("pass the session token")
const base = "http://127.0.0.1:3000/v1"

const req = async (path, options = {}) => {
  const res = await fetch(base + path, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} -> ${res.status} ${text}`)
  }
  return body
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const chunks = await req("/projects/link/chunks")
console.log("chunks", chunks.map((chunk) => `${chunk.name} ${chunk.state}`).join(", "))

for (const chunk of chunks) {
  if (chunk.state === "matched") {
    console.log(chunk.name, "already matched")
    continue
  }
  if (chunk.state === "leased" || chunk.state === "validating") {
    await req(`/projects/link/chunks/${chunk.id}/clear`, { method: "POST" })
  }
  const lease = await req(`/projects/link/chunks/${chunk.id}/checkout`, { method: "POST" })
  const submitted = await req(`/projects/link/chunks/${chunk.id}/submit`, {
    method: "POST",
    body: JSON.stringify({
      leaseToken: lease.leaseToken,
      source: lease.bundle.pseudocode
    })
  })
  let finished = null
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    const attempts = await req(`/projects/link/chunks/${chunk.id}/attempts`)
    finished = attempts.find((attempt) => attempt.id === submitted.attemptId)
    if (finished?.finishedAt) break
  }
  console.log(
    chunk.name,
    finished?.matched,
    finished?.score,
    (finished?.diagnostics ?? "").split("\n")[0]
  )
  if (!finished?.matched) {
    console.log(finished?.diagnostics)
    throw new Error(`${chunk.name} did not match in isolation`)
  }
}

const started = await req("/projects/link/integrations", {
  method: "POST",
  body: JSON.stringify({ language: "c" })
})
console.log("integration", started.id, started.status, started.summary)

let integration = started
for (let i = 0; i < 20; i++) {
  if (integration.status !== "queued" && integration.status !== "running") break
  await sleep(1000)
  const rows = await req("/projects/link/integrations")
  integration = rows.find((row) => row.id === started.id) ?? rows[0]
}
console.log("final", integration.status, integration.summary)
for (const unit of integration.units) {
  console.log(`  ${unit.name} passed=${unit.passed} ${unit.detail.split("\n")[0]}`)
}

const after = await req("/projects/link/chunks")
console.log("states", after.map((chunk) => `${chunk.name}=${chunk.state}`).join(", "))

const decoy = after.find((chunk) => chunk.name === "decoy")
const reopened = await req(`/projects/link/chunks/${decoy.id}/checkout`, { method: "POST" })
console.log("decoy checkout", reopened.chunk.state, Boolean(reopened.bundle.bestAttemptSource))
await req(`/projects/link/chunks/${decoy.id}/release`, {
  method: "POST",
  body: JSON.stringify({ leaseToken: reopened.leaseToken })
})

const demo = await req("/projects/demo/settings", {
  method: "PATCH",
  body: JSON.stringify({ language: "cpp", flags: ["-O2"] })
})
console.log("demo language", demo.language, demo.toolchain.compiler)
const restored = await req("/projects/demo/settings", {
  method: "PATCH",
  body: JSON.stringify({ language: "c", flags: ["-O2"] })
})
console.log("demo restored", restored.language, restored.toolchain.compiler)
