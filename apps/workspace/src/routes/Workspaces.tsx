import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Check, X, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useWorkspace, setActiveWorkspaceSlug } from "@/lib/workspace";

export function Workspaces() {
  const queryClient = useQueryClient();
  const { workspaces, refresh } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const createWorkspace = useMutation({
    mutationFn: api.createWorkspace,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      refresh();
      setCreating(false);
      setName("");
      setSlug("");
    },
  });

  const updateWorkspace = useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: { name: string } }) =>
      api.updateWorkspace(uuid, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      refresh();
      setEditingUuid(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const derivedSlug =
      slug.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    createWorkspace.mutate({ name: name.trim(), slug: derivedSlug });
  };

  const saveName = (uuid: string) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    updateWorkspace.mutate({ uuid, body: { name: trimmed } });
  };

  const switchTo = (slug: string) => {
    setActiveWorkspaceSlug(slug);
    localStorage.setItem("ploy-gyms:workspace-slug", slug);
    window.location.href = "/";
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground">
            Gyms and clients. Each workspace can have multiple sites.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="h-4 w-4" />
          New workspace
        </Button>
      </div>

      {creating && (
        <form onSubmit={handleSubmit} className="mt-6 max-w-md space-y-4 rounded-lg border bg-card p-6">
          <div className="space-y-2">
            <label htmlFor="workspace-name" className="text-sm font-medium">Workspace name</label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) {
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, "-")
                      .replace(/^-|-$/g, ""),
                  );
                }
              }}
              placeholder="Acme Fitness"
              required
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="workspace-slug" className="text-sm font-medium">Slug</label>
            <Input
              id="workspace-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-fitness"
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={createWorkspace.isPending}>
              {createWorkspace.isPending ? "Creating..." : "Create workspace"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCreating(false);
                setName("");
                setSlug("");
              }}
            >
              Cancel
            </Button>
          </div>
          {createWorkspace.isError && (
            <p className="text-sm text-destructive">{createWorkspace.error?.message}</p>
          )}
        </form>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((workspace) => (
          <div key={workspace.uuid} className="rounded-lg border bg-card p-6">
            {editingUuid === workspace.uuid ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName(workspace.uuid);
                    if (e.key === "Escape") setEditingUuid(null);
                  }}
                  className="h-8 flex-1"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => saveName(workspace.uuid)}
                  disabled={updateWorkspace.isPending}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setEditingUuid(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{workspace.name}</h3>
                  <p className="text-sm text-muted-foreground">/{workspace.slug}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditingUuid(workspace.uuid);
                      setEditName(workspace.name);
                    }}
                    title="Rename workspace"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => switchTo(workspace.slug)}
                  >
                    Switch
                  </Button>
                </div>
              </div>
            )}
            <div className="mt-4 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-xs font-medium capitalize">
                {workspace.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
