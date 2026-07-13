import { useWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { workspaces, currentWorkspaceSlug, setCurrentWorkspaceSlug, isLoading } = useWorkspace();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b px-4">
        <div className="flex items-center gap-4">
          <span className="font-semibold">Milo admin</span>
          {isLoading ? (
            <span className="text-sm text-muted-foreground">Loading workspaces…</span>
          ) : (
            <select
              className="rounded border bg-background px-2 py-1 text-sm"
              value={currentWorkspaceSlug}
              onChange={(e) => setCurrentWorkspaceSlug(e.target.value)}
            >
              {workspaces.map((ws) => (
                <option key={ws.slug} value={ws.slug}>
                  {ws.name} ({ws.slug})
                </option>
              ))}
            </select>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </header>
      {children}
    </div>
  );
}
