import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "@/components/layout"
import { AuthProvider } from "@/lib/auth"
import { ThemeProvider } from "@/lib/theme"
import { ChunkPage } from "@/pages/chunk"
import { FaqPage } from "@/pages/faq"
import { FollowingProjectsPage } from "@/pages/following-projects"
import { FollowingUsersPage } from "@/pages/following-users"
import { HomePage } from "@/pages/home"
import { LoginPage } from "@/pages/login"
import { NewProjectPage } from "@/pages/new-project"
import { PeoplePage } from "@/pages/people"
import { ProfilePage } from "@/pages/profile"
import { ProjectPage } from "@/pages/project"
import { ProjectsPage } from "@/pages/projects"
import { ProposalPage } from "@/pages/proposal"
import { TypesPage } from "@/pages/types"

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="login" element={<LoginPage />} />
              <Route path="faq" element={<FaqPage />} />
              <Route path="people" element={<PeoplePage />} />
              <Route path="following/users" element={<FollowingUsersPage />} />
              <Route path="following/projects" element={<FollowingProjectsPage />} />
              <Route path="users/:userId" element={<ProfilePage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/new" element={<NewProjectPage />} />
              <Route path="projects/:projectSlug" element={<ProjectPage />} />
              <Route path="projects/:projectSlug/types" element={<TypesPage />} />
              <Route
                path="projects/:projectSlug/type-proposals/:proposalId"
                element={<ProposalPage />}
              />
              <Route path="projects/:projectSlug/chunks/:chunkId" element={<ChunkPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
