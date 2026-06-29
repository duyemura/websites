import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function Settings() {
  const queryClient = useQueryClient();
  const { currentWorkspaceSlug } = useWorkspace();
  const { data: workspace, isLoading } = useQuery({
    queryKey: ["workspace", currentWorkspaceSlug],
    queryFn: api.getWorkspace,
  });

  const [name, setName] = useState("");
  const [brandPrimaryColor, setBrandPrimaryColor] = useState("");
  const [brandFontHeading, setBrandFontHeading] = useState("");
  const [brandFontBody, setBrandFontBody] = useState("");

  useEffect(() => {
    if (!workspace) return;
    setName(workspace.name);
    setBrandPrimaryColor(workspace.brandPrimaryColor ?? "");
    setBrandFontHeading(workspace.brandFontHeading ?? "");
    setBrandFontBody(workspace.brandFontBody ?? "");
  }, [workspace]);

  const updateWorkspace = useMutation({
    mutationFn: (body: object) =>
      workspace ? api.updateWorkspace(workspace.uuid, body) : Promise.reject(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateWorkspace.mutate({
      name,
      brandPrimaryColor: brandPrimaryColor || undefined,
      brandFontHeading: brandFontHeading || undefined,
      brandFontBody: brandFontBody || undefined,
    });
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <p className="text-muted-foreground">Workspace and integration settings.</p>

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading…</p>
      ) : workspace ? (
        <form
          onSubmit={handleSubmit}
          className="mt-8 max-w-xl space-y-4 rounded-lg border bg-card p-6"
        >
          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium">
              Workspace name
            </label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label htmlFor="primary-color" className="text-sm font-medium">
                Primary color
              </label>
              <Input
                id="primary-color"
                value={brandPrimaryColor}
                onChange={(e) => setBrandPrimaryColor(e.target.value)}
                placeholder="#000000"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="heading-font" className="text-sm font-medium">
                Heading font
              </label>
              <Input
                id="heading-font"
                value={brandFontHeading}
                onChange={(e) => setBrandFontHeading(e.target.value)}
                placeholder="Inter"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="body-font" className="text-sm font-medium">
                Body font
              </label>
              <Input
                id="body-font"
                value={brandFontBody}
                onChange={(e) => setBrandFontBody(e.target.value)}
                placeholder="Inter"
              />
            </div>
          </div>
          <Button type="submit" disabled={updateWorkspace.isPending}>
            {updateWorkspace.isPending ? "Saving…" : "Save changes"}
          </Button>
          {updateWorkspace.isError && (
            <p className="text-sm text-destructive">
              {updateWorkspace.error?.message}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-8 text-muted-foreground">Workspace not found.</p>
      )}
    </div>
  );
}
