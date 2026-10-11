import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Icon } from "./components/Icon";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Tasks from "./pages/Tasks";
import TaskWorkspace from "./pages/TaskWorkspace";
import Projects, { ProjectDetail } from "./pages/Projects";
import ArtifactsPage from "./pages/ArtifactsPage";
import Files from "./pages/Files";
import Usage from "./pages/Usage";
import Pricing from "./pages/Pricing";
import Checkout from "./pages/Checkout";
import Settings from "./pages/Settings";
import Admin from "./pages/Admin";

function Splash() {
  return <div className="grid h-full place-items-center text-brand-600"><Icon name="spinner" className="h-8 w-8 animate-spin" /></div>;
}

/** "/" shows the marketing page to guests and the app shell to signed-in users. */
function Gate() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  if (loading) return <Splash />;
  if (user) return <Layout />;
  return pathname === "/" ? <Landing /> : <Navigate to="/login" replace />;
}

function AdminOnly({ children }: { children: JSX.Element }) {
  const { profile } = useAuth();
  return profile?.role === "admin" ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Gate />}>
        <Route index element={<Home />} />
        <Route path="task/:id" element={<TaskWorkspace />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="artifacts" element={<ArtifactsPage />} />
        <Route path="files" element={<Files />} />
        <Route path="usage" element={<Usage />} />
        <Route path="billing" element={<Pricing />} />
        <Route path="checkout/:planId" element={<Checkout />} />
        <Route path="settings" element={<Settings />} />
        <Route path="admin" element={<AdminOnly><Admin /></AdminOnly>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
