import * as React from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ApiError, api, type JoinRequest, type MyJoinRequestState } from "@/lib/api"

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

function RequestLine(props: {
  readonly request: JoinRequest
  readonly showProject: boolean
  readonly busy: boolean
  readonly onApprove: () => void
  readonly onDecline: () => void
}) {
  const { request, showProject, busy } = props
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2">
      <div className="min-w-0 space-y-0.5">
        <p>
          <Link to={`/users/${request.userId}`} className="font-medium underline-offset-2 hover:underline">
            {request.displayName}
          </Link>
          {showProject ? (
            <>
              {" "}asked to join{" "}
              <Link to={`/projects/${request.projectSlug}`} className="underline-offset-2 hover:underline">
                {request.projectName}
              </Link>
            </>
          ) : null}
          <span className="ml-2 text-xs text-muted-foreground">{new Date(request.createdAt).toLocaleDateString()}</span>
        </p>
        {request.message ? (
          <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">“{request.message}”</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={props.onApprove}>
          Approve
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={props.onDecline}>
          Decline
        </Button>
      </div>
    </li>
  )
}

/**
 * For owners and maintainers, inside the project's Members card: open
 * requests to join, with Approve (adds a contributor) and Decline. onAnswered
 * runs after either, so the page can refresh members and counts.
 */
export function JoinRequestsReview(props: {
  readonly projectSlug: string
  readonly token: string
  readonly onAnswered: () => void
}) {
  const { projectSlug, token, onAnswered } = props
  const [requests, setRequests] = React.useState<ReadonlyArray<JoinRequest>>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api.listJoinRequests(projectSlug, token).then(
      (rows) => { if (!cancelled) setRequests(rows) },
      () => {}
    )
    return () => { cancelled = true }
  }, [projectSlug, token])

  async function answer(request: JoinRequest, approve: boolean) {
    setBusy(true)
    setError(null)
    try {
      setRequests(
        approve
          ? await api.approveJoinRequest(projectSlug, request.id, token)
          : await api.declineJoinRequest(projectSlug, request.id, token)
      )
      onAnswered()
    } catch (err) {
      setError(errorText(err, "Could not answer the request"))
    } finally {
      setBusy(false)
    }
  }

  if (requests.length === 0 && error === null) return null

  return (
    <div className="space-y-1 rounded-md border p-3">
      <p className="text-sm font-medium">Join requests ({requests.length})</p>
      <ul className="divide-y text-sm">
        {requests.map((r) => (
          <RequestLine
            key={r.id}
            request={r}
            showProject={false}
            busy={busy}
            onApprove={() => void answer(r, true)}
            onDecline={() => void answer(r, false)}
          />
        ))}
      </ul>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

/**
 * For a signed-in non-member of a members-only project: ask to join, see
 * that the request is waiting, or when they may ask again after a decline.
 */
export function JoinRequestBox(props: { readonly projectSlug: string; readonly token: string }) {
  const { projectSlug, token } = props
  const [state, setState] = React.useState<MyJoinRequestState | null>(null)
  const [message, setMessage] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    api.myJoinRequest(projectSlug, token).then(
      (s) => { if (!cancelled) setState(s) },
      () => {}
    )
    return () => { cancelled = true }
  }, [projectSlug, token])

  async function run(action: () => Promise<MyJoinRequestState>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      setState(await action())
      setMessage("")
    } catch (err) {
      setError(errorText(err, failure))
    } finally {
      setBusy(false)
    }
  }

  if (state === null) return null

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      {state.request ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            You asked to join on {new Date(state.request.createdAt).toLocaleDateString()}. A maintainer will
            answer.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => api.cancelJoinRequest(projectSlug, token), "Could not cancel the request")}
          >
            Cancel request
          </Button>
        </div>
      ) : state.retryAfter ? (
        <p className="text-muted-foreground">
          Your last request was declined. You can ask again after {new Date(state.retryAfter).toLocaleString()}.
        </p>
      ) : (
        <>
          <p>This project takes work from its members only. Ask the maintainers to add you as a contributor.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Optional message, for example what you would work on"
              value={message}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
              className="min-w-64 flex-1"
            />
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void run(() => api.requestToJoin(projectSlug, message.trim(), token), "Could not send the request")}
            >
              Request to join
            </Button>
          </div>
        </>
      )}
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  )
}

/**
 * For My work on your own profile: requests waiting on you across every
 * project you own or maintain, and your own requests still waiting.
 */
export function JoinRequestsWork(props: { readonly token: string }) {
  const { token } = props
  const [waiting, setWaiting] = React.useState<ReadonlyArray<JoinRequest>>([])
  const [yours, setYours] = React.useState<ReadonlyArray<JoinRequest>>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    const result = await api.myJoinRequests(token)
    setWaiting(result.waitingOnYou)
    setYours(result.yours)
  }, [token])

  React.useEffect(() => { void load().catch(() => {}) }, [load])

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(errorText(err, failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {waiting.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Waiting on you</CardTitle>
            <CardDescription>Requests to join projects you own or maintain. Approving adds a contributor.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {waiting.map((r) => (
                <RequestLine
                  key={r.id}
                  request={r}
                  showProject
                  busy={busy}
                  onApprove={() => void run(() => api.approveJoinRequest(r.projectSlug, r.id, token), "Could not approve")}
                  onDecline={() => void run(() => api.declineJoinRequest(r.projectSlug, r.id, token), "Could not decline")}
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {yours.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Your join requests</CardTitle>
            <CardDescription>Waiting for a maintainer to answer.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {yours.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link to={`/projects/${r.projectSlug}`} className="font-medium underline-offset-2 hover:underline">
                      {r.projectName}
                    </Link>
                    <span className="ml-2 text-xs text-muted-foreground">
                      asked {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => api.cancelJoinRequest(r.projectSlug, token), "Could not cancel")}
                  >
                    Cancel request
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </>
  )
}
