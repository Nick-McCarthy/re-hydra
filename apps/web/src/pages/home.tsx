import * as React from "react"
import { Link } from "react-router-dom"
import { ActivityList } from "@/components/activity-list"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { api, type ProjectEvent } from "@/lib/api"
import { useAuth } from "@/lib/auth"

export function HomePage() {
  const { user, session } = useAuth()
  const [events, setEvents] = React.useState<Array<ProjectEvent> | null>(null)

  React.useEffect(() => {
    if (!session) {
      setEvents(null)
      return
    }
    let cancelled = false
    void api.feed(session.token).then(
      (feed) => {
        if (!cancelled) setEvents(feed)
      },
      () => {
        if (!cancelled) setEvents([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [session])

  return (
    <div className="space-y-8">
    <div className="relative overflow-hidden rounded-2xl border bg-background px-6 py-16 sm:px-10">
      <div className="max-w-xl space-y-6">
        <p className="text-sm font-medium tracking-[0.2em] text-muted-foreground uppercase">
          re-hydra
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Exclusive chunk checkout for crowdsourced RE
        </h1>
        <p className="text-base text-muted-foreground">
          Lease a function, translate locally, submit for byte-perfect matching.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/projects">Browse projects</Link>
          </Button>
          {!user ? (
            <Button asChild variant="outline" size="lg">
              <Link to="/login">Sign in</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
      {session ? (
        <Card>
          <CardHeader>
            <CardTitle>Following</CardTitle>
            <CardDescription>
              Activity from projects and people you follow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {events === null ? (
              <p className="text-sm text-muted-foreground">Loading feed…</p>
            ) : (
              <ActivityList events={events} />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
