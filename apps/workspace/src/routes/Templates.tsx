import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, LayoutTemplate, ExternalLink } from "lucide-react";
import { api, type Template } from "@/lib/api";

function isUrlTemplate(template: Template): boolean {
  return template.tags?.includes("url-template") ?? false;
}

export function Templates() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Imported");

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.getTemplates(false),
  });

  const createTemplate = useMutation({
    mutationFn: api.createTemplateFromUrl,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setUrl("");
      setName("");
      setCategory("Imported");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    createTemplate.mutate({
      url: url.trim(),
      name: name.trim() || undefined,
      category: category.trim() || undefined,
    });
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          <p className="text-muted-foreground">
            Save any website as a private workspace template, then build a site on top of its structure.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Create template from URL</h2>
        <p className="text-sm text-muted-foreground">
          We will pull down the homepage structure, spacing, and section order, then anonymize the content so you can fill it in later.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Input
            type="url"
            placeholder="https://example-gym.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <Input
            placeholder="Template name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Category (optional)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" disabled={createTemplate.isPending || !url.trim()}>
            {createTemplate.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-2 h-4 w-4" />
            )}
            {createTemplate.isPending ? "Creating shell…" : "Create template shell"}
          </Button>
          {createTemplate.isError && (
            <p className="text-sm text-destructive">
              {createTemplate.error?.message.replace(/^\d+:\s*/, "")}
            </p>
          )}
        </div>
      </form>

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading templates…</p>
      ) : templates && templates.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template: Template) => (
            <div key={template.uuid} className="rounded-lg border bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted">
                  <LayoutTemplate className="h-5 w-5 text-muted-foreground" />
                </div>
                {isUrlTemplate(template) && (
                  <Badge variant="outline" className="text-xs">
                    URL shell
                  </Badge>
                )}
              </div>
              <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {template.category ?? "General"}
              </p>
              <h3 className="mt-1 font-semibold">{template.name}</h3>
              {template.tags && template.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {template.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs capitalize">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              {template.thumbnailUrl && (
                <a
                  href={template.thumbnailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                  View thumbnail
                </a>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border border-dashed bg-card p-12 text-center">
          <p className="text-muted-foreground">No templates yet. Paste a URL above to create your first template shell.</p>
        </div>
      )}
    </div>
  );
}
