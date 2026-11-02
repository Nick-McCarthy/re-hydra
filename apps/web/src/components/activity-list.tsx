import { Link } from "react-router-dom"
import type { ProjectEvent } from "@/lib/api"

export function ActivityList({ events }: { events: Array<ProjectEvent> }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>
  }

  return (
    <ul className="divide-y">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 py-3 text-sm">
          <time className="text-xs text-muted-foreground">
            {new Date(event.createdAt).toLocaleString()}
          </time>
          {event.actorId && event.actorName ? (
            <Link
              to={`/users/${event.actorId}`}
              className="font-medium underline-offset-2 hover:underline"
            >
              {event.actorName}
            </Link>
          ) : (
            <span className="text-muted-foreground">system</span>
          )}
          <span>{event.summary}</span>
          <Link
            to={`/projects/${event.projectSlug}`}
            className="text-muted-foreground underline-offset-2 hover:underline"
          >
            {event.projectName}
          </Link>
        </li>
      ))}
    </ul>
  )
}
