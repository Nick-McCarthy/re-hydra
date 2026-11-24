import * as React from "react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { ApiError, api, type OwnershipOffer } from "@/lib/api"

/**
 * Profile phase 1. Ownership offers waiting on the signed-in user (A-011),
 * which otherwise show only on each project's page.
 */
export function OwnershipOffersBanner(props: { readonly token: string; readonly onChanged: () => void }) {
  const { token, onChanged } = props
  const [offers, setOffers] = React.useState<ReadonlyArray<OwnershipOffer>>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      setOffers(await api.myOwnershipOffers(token))
    } catch {
      setOffers([])
    }
  }, [token])

  React.useEffect(() => { void load() }, [load])

  async function respond(offer: OwnershipOffer, accept: boolean) {
    setBusy(true)
    setError(null)
    try {
      if (accept) await api.acceptOwnership(offer.projectSlug, token)
      else await api.withdrawOwnership(offer.projectSlug, token)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not answer the offer")
    } finally {
      setBusy(false)
    }
  }

  if (offers.length === 0 && error === null) return null

  return (
    <div className="space-y-2">
      {offers.map((offer) => (
        <div key={offer.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <span>
            {offer.offeredByName} offered you ownership of{" "}
            <Link to={`/projects/${offer.projectSlug}`} className="font-medium underline underline-offset-2">
              {offer.projectName}
            </Link>
            , until {new Date(offer.expiresAt).toLocaleDateString()}.
          </span>
          <Button size="sm" disabled={busy} onClick={() => void respond(offer, true)}>
            Accept
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void respond(offer, false)}>
            Decline
          </Button>
        </div>
      ))}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
