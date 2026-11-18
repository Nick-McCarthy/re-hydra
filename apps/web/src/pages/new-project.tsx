import * as React from "react"
import { Navigate, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, api, type SourceLanguage } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { driverFor, imageTag, recipeBySystem, systemRecipes } from "@/lib/recipes"

const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

export function NewProjectPage() {
  const { session, ready } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = React.useState("")
  const [slug, setSlug] = React.useState("")
  const [slugEdited, setSlugEdited] = React.useState(false)
  const [description, setDescription] = React.useState("")
  const [system, setSystem] = React.useState("PlayStation 2")
  const [language, setLanguage] = React.useState<SourceLanguage>("c")
  const [flags, setFlags] = React.useState("-O2")
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const recipe = recipeBySystem(system)

  if (!ready) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  const token = session.token

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const nextSlug = slug.trim()
    const flagList = flags.split(/\s+/).filter((flag) => flag.length > 0)
    if (name.trim().length === 0 || nextSlug.length === 0) {
      setError("Name and slug are required.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await api.createProject(token, {
        slug: nextSlug,
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        homeRegion: "local",
        language: recipe.cOnly ? "c" : language,
        toolchain: {
          compiler: driverFor(recipe.compiler, recipe.cOnly ? "c" : language),
          version: imageTag(recipe.image),
          flags: flagList.length > 0 ? flagList : ["-O2"],
          image: recipe.image
        }
      })
      navigate(`/projects/${created.slug}`)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "A project already uses that slug."
          : err instanceof ApiError
            ? err.message
            : "Could not create the project"
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
          <CardDescription>
            You become the owner. On the board, drop the JSON from ExportReHydra.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void submit(e)}>
            <div className="space-y-2">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => {
                  const next = e.target.value
                  setName(next)
                  if (!slugEdited) setSlug(slugify(next))
                }}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-slug">Slug</Label>
              <Input
                id="project-slug"
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true)
                  setSlug(slugify(e.target.value))
                }}
                required
                className="font-mono"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="project-description">Description</Label>
              <Input
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-system">System</Label>
              <select
                id="project-system"
                value={system}
                onChange={(e) => {
                  const next = e.target.value
                  setSystem(next)
                  if (recipeBySystem(next).cOnly) setLanguage("c")
                }}
                className={selectClass}
              >
                {systemRecipes.map((row) => (
                  <option key={row.system} value={row.system}>
                    {row.system}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-language">Language</Label>
              <select
                id="project-language"
                value={recipe.cOnly ? "c" : language}
                onChange={(e) => setLanguage(e.target.value === "cpp" ? "cpp" : "c")}
                disabled={recipe.cOnly}
                className={selectClass}
              >
                <option value="c">C</option>
                <option value="cpp">C++</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-flags">Flags</Label>
              <Input id="project-flags" value={flags} onChange={(e) => setFlags(e.target.value)} />
            </div>
            <p className="self-end font-mono text-xs text-muted-foreground">
              {driverFor(recipe.compiler, recipe.cOnly ? "c" : language)} {imageTag(recipe.image)}
            </p>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create project"}
              </Button>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
