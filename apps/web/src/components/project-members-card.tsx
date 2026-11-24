import * as React from "react"
import { Link } from "react-router-dom"
import { JoinRequestBox, JoinRequestsReview } from "@/components/join-requests"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ApiError,
  api,
  type OwnershipOffer,
  type ProjectMember,
  type ProjectMembership,
  type UserSearchHit
} from "@/lib/api"

type Role = ProjectMembership["role"]

/**
 * Audit A-011. Everyone sees who the members are. The owner adds, promotes,
 * demotes, and removes anyone and can offer ownership; maintainers add and
 * remove contributors; any member but the owner can leave. An ownership offer
 * shows here for the owner and for the person it was made to. On a
 * members-only project, non-members can ask to join here, and owners and
 * maintainers answer those requests here.
 */
export function ProjectMembersCard(props: {
  readonly projectSlug: string
  readonly session: { readonly token: string; readonly userId: string } | null
  readonly myRole: Role | null
  readonly checkoutPolicy: "open" | "members"
  readonly onChanged: () => void
}) {
  const { projectSlug, session, myRole, checkoutPolicy, onChanged } = props
  const [members, setMembers] = React.useState<ReadonlyArray<ProjectMember> | null>(null)
  const [offer, setOffer] = React.useState<OwnershipOffer | null>(null)
  const [query, setQuery] = React.useState("")
  const [hits, setHits] = React.useState<ReadonlyArray<UserSearchHit>>([])
  const [addRole, setAddRole] = React.useState<"maintainer" | "contributor">("contributor")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const token = session?.token ?? null
  const me = session?.userId ?? null
  const isOwner = myRole === "owner"
  const canManage = myRole === "owner" || myRole === "maintainer"

  React.useEffect(() => {
    let cancelled = false
    api.listMembers(projectSlug)
      .then((rows) => { if (!cancelled) setMembers(rows) })
      .catch(() => { if (!cancelled) setError("Could not load members") })
    if (token) {
      api.ownershipOffer(projectSlug, token)
        .then((state) => { if (!cancelled) setOffer(state.offer) })
        .catch(() => {})
    } else {
      setOffer(null)
    }
    return () => { cancelled = true }
  }, [projectSlug, token])

  async function run(action: () => Promise<void>, failure: string, changed = true) {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (changed) onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : failure)
    } finally {
      setBusy(false)
    }
  }

  if (members === null && error === null) {
    return null
  }

  const memberIds = new Set((members ?? []).map((m) => m.userId))

  const search = () =>
    run(async () => {
      setHits(query.trim().length === 0 ? [] : await api.searchUsers(query.trim()))
    }, "Could not search users", false)

  const add = (userId: string) =>
    run(async () => {
      if (!token) return
      setMembers(await api.addMember(projectSlug, userId, isOwner ? addRole : "contributor", token))
      setHits([])
      setQuery("")
    }, "Could not add this member")

  const changeRole = (userId: string, role: "maintainer" | "contributor") =>
    run(async () => {
      if (!token) return
      setMembers(await api.changeMemberRole(projectSlug, userId, role, token))
    }, "Could not change the role")

  const remove = (member: ProjectMember) => {
    const leaving = member.userId === me
    const question = leaving
      ? "Leave this project?"
      : `Remove ${member.displayName} from this project?`
    if (!window.confirm(question)) return
    void run(async () => {
      if (!token) return
      setMembers(await api.removeMember(projectSlug, member.userId, token))
    }, leaving ? "Could not leave the project" : "Could not remove this member")
  }

  const offerTo = (member: ProjectMember) => {
    if (!window.confirm(`Offer ownership of this project to ${member.displayName}? You become a maintainer when they accept.`)) return
    void run(async () => {
      if (!token) return
      setOffer((await api.offerOwnership(projectSlug, member.userId, token)).offer)
    }, "Could not offer ownership")
  }

  const accept = () =>
    run(async () => {
      if (!token) return
      setMembers(await api.acceptOwnership(projectSlug, token))
      setOffer(null)
    }, "Could not accept ownership")

  const withdraw = () =>
    run(async () => {
      if (!token) return
      setOffer((await api.withdrawOwnership(projectSlug, token)).offer)
    }, "Could not withdraw the offer")

  const controls = (member: ProjectMember) => {
    if (!session || busy) return null
    const buttons: Array<React.ReactNode> = []
    if (member.userId === me) {
      if (member.role !== "owner") {
        buttons.push(
          <Button key="leave" size="sm" variant="outline" onClick={() => remove(member)}>
            Leave
          </Button>
        )
      }
      return buttons
    }
    if (member.role === "owner") return null
    if (isOwner) {
      buttons.push(
        member.role === "contributor" ? (
          <Button key="role" size="sm" variant="outline" onClick={() => void changeRole(member.userId, "maintainer")}>
            Make maintainer
          </Button>
        ) : (
          <Button key="role" size="sm" variant="outline" onClick={() => void changeRole(member.userId, "contributor")}>
            Make contributor
          </Button>
        )
      )
      if (offer === null) {
        buttons.push(
          <Button key="offer" size="sm" variant="outline" onClick={() => offerTo(member)}>
            Offer ownership
          </Button>
        )
      }
    }
    if (isOwner || (myRole === "maintainer" && member.role === "contributor")) {
      buttons.push(
        <Button key="remove" size="sm" variant="destructive" onClick={() => remove(member)}>
          Remove
        </Button>
      )
    }
    return buttons
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          Maintainers review type proposals and run the project with the owner. A second
          maintainer means proposals are accepted by someone other than the person who
          started the recheck.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {offer && me && offer.offeredTo === me ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
            <span>
              {offer.offeredByName} offered you ownership of this project, until{" "}
              {new Date(offer.expiresAt).toLocaleDateString()}.
            </span>
            <Button size="sm" onClick={() => void accept()} disabled={busy}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => void withdraw()} disabled={busy}>
              Decline
            </Button>
          </div>
        ) : null}
        {offer && me && offer.offeredBy === me ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
            <span>
              Ownership offered to {offer.offeredToName}, until{" "}
              {new Date(offer.expiresAt).toLocaleDateString()}.
            </span>
            <Button size="sm" variant="outline" onClick={() => void withdraw()} disabled={busy}>
              Withdraw
            </Button>
          </div>
        ) : null}

        {canManage && token ? (
          <JoinRequestsReview
            projectSlug={projectSlug}
            token={token}
            onApproved={() => {
              void api.listMembers(projectSlug).then(setMembers)
              onChanged()
            }}
          />
        ) : null}
        {token && myRole === null && checkoutPolicy === "members" ? (
          <JoinRequestBox projectSlug={projectSlug} token={token} />
        ) : null}

        <ul className="space-y-1 text-sm">
          {(members ?? []).map((member) => (
            <li key={member.userId} className="flex flex-wrap items-center gap-2">
              <Link to={`/users/${member.userId}`} className="font-medium underline-offset-2 hover:underline">
                {member.displayName}
              </Link>
              <Badge variant={member.role === "contributor" ? "outline" : "secondary"}>{member.role}</Badge>
              {controls(member)}
            </li>
          ))}
        </ul>

        {canManage && session ? (
          <div className="space-y-2">
            <Label htmlFor="memberSearch">Add a member</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="memberSearch"
                placeholder="Display name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void search() }}
                className="w-56"
              />
              {isOwner ? (
                <select
                  aria-label="Role for the new member"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value === "maintainer" ? "maintainer" : "contributor")}
                >
                  <option value="contributor">contributor</option>
                  <option value="maintainer">maintainer</option>
                </select>
              ) : null}
              <Button variant="outline" onClick={() => void search()} disabled={busy}>
                Search
              </Button>
            </div>
            {hits.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {hits.map((hit) => (
                  <li key={hit.id} className="flex items-center gap-2">
                    <span>{hit.displayName}</span>
                    {memberIds.has(hit.id) ? (
                      <span className="text-xs text-muted-foreground">already a member</span>
                    ) : (
                      <Button size="sm" onClick={() => void add(hit.id)} disabled={busy}>
                        Add as {isOwner ? addRole : "contributor"}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
