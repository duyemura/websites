import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { api, type Site } from "@/lib/api";

export function Dashboard() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [templateKey, setTemplateKey] = useState("");

  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: api.getSites,
  });

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: api.getTemplates,
  });

  const createSite = useMutation({
    mutationFn: api.createSite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setCreating(false);
      setName("");
      setSlug("");
      setTemplateKey("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createSite.mutate({ name, slug, templateKey: templateKey || undefined });
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sites</h1>
          <p className="text-muted-foreground">Manage your gym websites.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" />
          New site
        </Button>
      </div>

      {creating && (
        <form onSubmit={handleSubmit} className="mt-6 rounded-lg border bg-card p-6 space-y-4 max-w-md">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="site-name">Site name</label>
            <input
              id="site-name"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slug) {
                  setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""));
                }
              }}
              placeholder="Acme Fitness"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="site-slug">Slug</label>
            <input
              id="site-slug"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-fitness"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="site-template">Template</label>
            <select
              id="site-template"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
            >
              <option value="">Blank site</option>
              {templates?.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={createSite.isPending}>
              {createSite.isPending ? "Creating..." : "Create site"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
          {createSite.isError && (
            <p className="text-sm text-destructive">{createSite.error.message}</p>
          )}
        </form>
      )}

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading...</p>
      ) : sites && sites.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site: Site) => (
            <div key={site.uuid} className="rounded-lg border bg-card p-6">
              <h3 className="font-semibold">{site.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">/{site.slug}</p>
              <span className="mt-3 inline-flex items-center rounded-full bg-muted px-2 py-1 text-xs font-medium capitalize">
                {site.status}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">No sites yet. Create one to get started.</p>
        </div>
      )}
    </div>
  );
}
