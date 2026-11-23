import { Navigate, useParams } from "react-router-dom"

/** Old chunk links open the work dialog on the project board. */
export function ChunkPage() {
  const { projectSlug = "", chunkId = "" } = useParams()
  const target = `/projects/${encodeURIComponent(projectSlug)}?work=${encodeURIComponent(chunkId)}`
  return <Navigate to={target} replace />
}
