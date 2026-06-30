import { NavLink, Outlet } from "react-router";
import { Dumbbell, FileText, Image, LayoutTemplate, BookOpen, Settings, Users, Activity } from "lucide-react";
import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", icon: LayoutTemplate, label: "Sites" },
  { to: "/templates", icon: LayoutTemplate, label: "Templates" },
  { to: "/docs", icon: FileText, label: "Docs" },
  { to: "/assets", icon: Image, label: "Assets" },
  { to: "/playbooks", icon: BookOpen, label: "Playbooks" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

const devNavItems = [
  { to: "/settings/ai-activity", icon: Activity, label: "AI activity" },
];

export function Shell() {
  const { workspaces, currentWorkspaceSlug, setCurrentWorkspaceSlug, isLoading } =
    useWorkspace();

  const selectWorkspace = (slug: string) => {
    setCurrentWorkspaceSlug(slug);
    window.location.reload();
  };

  const currentWorkspace = workspaces.find((w) => w.slug === currentWorkspaceSlug);

  return (
    <div className="flex h-screen w-full bg-background">
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="flex items-center gap-3 px-6 py-5 border-b">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Dumbbell className="h-5 w-5" />
          </div>
          <span className="font-semibold">Ploy for gyms</span>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/" || item.to === "/settings"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            );
          })}
          {import.meta.env.DEV && (
            <>
              <div className="my-3 border-t" />
              <p className="px-3 py-1 text-xs font-medium text-muted-foreground">Developer</p>
              {devNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                );
              })}
            </>
          )}
        </nav>
        <div className="border-t p-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading workspace…</p>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Workspace</label>
              <select
                value={currentWorkspaceSlug}
                onChange={(e) => selectWorkspace(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.slug} value={workspace.slug}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              {currentWorkspace && (
                <p className="text-xs text-muted-foreground">{currentWorkspace.status}</p>
              )}
              <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                <NavLink to="/workspaces" className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Manage Workspaces
                </NavLink>
              </Button>
            </div>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

function cn(...inputs: (string | false | undefined)[]) {
  return inputs.filter(Boolean).join(" ");
}
