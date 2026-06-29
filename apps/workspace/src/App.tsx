import { Routes, Route } from "react-router";
import { Shell } from "@/components/layout/Shell";
import { Dashboard } from "@/routes/Dashboard";
import { SiteDetail } from "@/routes/SiteDetail";
import { Docs } from "@/routes/Docs";
import { Assets } from "@/routes/Assets";
import { Playbooks } from "@/routes/Playbooks";
import { Settings } from "@/routes/Settings";
import { Workspaces } from "@/routes/Workspaces";

function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sites/:uuid" element={<SiteDetail />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/playbooks" element={<Playbooks />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/workspaces" element={<Workspaces />} />
      </Route>
    </Routes>
  );
}

export default App;
