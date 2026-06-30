import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Loader2,
  Link2,
  LayoutTemplate,
  ExternalLink,
  ArrowRight,
  Palette,
  Type,
  Layout,
  List,
  FileText,
} from "lucide-react";
import { api, type Template } from "@/lib/api";
import { cn } from "@/lib/utils";

function isUrlTemplate(template: Template): boolean {
  return template.tags?.includes("url-template") ?? false;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function deriveSiteSlug(template: Template): string {
  if (template.sourceUrl) {
    try {
      const hostname = new URL(template.sourceUrl).hostname.replace(/^www\./, "");
      const base = hostname.split(".")[0]?.replace(/[^a-z0-9]+/g, "-") ?? "site";
      return base.replace(/^-|-$/g, "").toLowerCase() || "site";
    } catch {
      // fall through
    }
  }
  const base = template.key.replace(/-shell$/, "").replace(/[^a-z0-9]+/g, "-") ?? "site";
  return base.replace(/^-|-$/g, "").toLowerCase() || "site";
}

function deriveSiteName(template: Template): string {
  return template.name.replace(/\s+template$/i, "").replace(/\s+shell$/i, "") || "New site";
}

export function Templates() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Imported");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [createSiteOpen, setCreateSiteOpen] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [siteSlug, setSiteSlug] = useState("");

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

  const createSite = useMutation({
    mutationFn: (template: Template) =>
      api.createSiteFromTemplate(template.key, {
        name: siteName.trim() || deriveSiteName(template),
        slug: siteSlug.trim() || deriveSiteSlug(template),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      setCreateSiteOpen(false);
      setSelectedTemplate(null);
      setSiteName("");
      setSiteSlug("");
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

  const openCreateSite = (template: Template) => {
    setSelectedTemplate(template);
    setSiteName(deriveSiteName(template));
    setSiteSlug(deriveSiteSlug(template));
    setCreateSiteOpen(true);
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
        <div className="mt-8 flex flex-col gap-3">
          {templates.map((template: Template) => (
            <div
              key={template.uuid}
              className={cn(
                "flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50",
                selectedTemplate?.uuid === template.uuid && "ring-1 ring-primary",
              )}
            >
              <button
                onClick={() => setSelectedTemplate(template)}
                className="flex min-w-0 flex-1 items-center gap-4 text-left"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted">
                  <LayoutTemplate className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{template.name}</h3>
                    {isUrlTemplate(template) && (
                      <Badge variant="outline" className="text-xs">
                        URL shell
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {template.category ?? "General"}
                  </p>
                </div>
                {template.tags && template.tags.length > 0 && (
                  <div className="hidden flex-wrap gap-1 sm:flex">
                    {template.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs capitalize">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </button>
              {template.thumbnailUrl && (
                <a
                  href={template.thumbnailUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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

      {selectedTemplate && (
        <Dialog open onOpenChange={() => setSelectedTemplate(null)}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <LayoutTemplate className="h-5 w-5" />
                {selectedTemplate.name}
              </h2>
              <DialogClose onClick={() => setSelectedTemplate(null)} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {isUrlTemplate(selectedTemplate) && (
                <Badge variant="outline">URL shell</Badge>
              )}
              <Badge variant="secondary">{selectedTemplate.category ?? "General"}</Badge>
              {selectedTemplate.tags?.map((tag) => (
                <Badge key={tag} variant="secondary" className="capitalize">
                  {tag}
                </Badge>
              ))}
            </div>

            <div className="mt-4 space-y-4">
              {selectedTemplate.sourceUrl && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Link2 className="h-4 w-4" />
                      Source URL
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <a
                      href={selectedTemplate.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      {selectedTemplate.sourceUrl}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="h-4 w-4" />
                    AI instructions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {selectedTemplate.instructions ? (
                    <pre className="whitespace-pre-wrap rounded-md border bg-muted p-4 text-sm font-mono leading-relaxed">
                      {selectedTemplate.instructions}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No instructions available for this template.
                    </p>
                  )}
                </CardContent>
              </Card>

              {selectedTemplate.theme && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Palette className="h-4 w-4" />
                      Theme
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">Colors</h4>
                      <div className="flex flex-wrap gap-3">
                        {Object.entries(selectedTemplate.theme.colors).map(([key, value]) => (
                          <div key={key} className="flex items-center gap-2 rounded-md border px-2 py-1">
                            <span
                              className="h-5 w-5 rounded-full border"
                              style={{ backgroundColor: value }}
                            />
                            <span className="text-xs capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">Typography</h4>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Type className="h-4 w-4" />
                        <span>Heading: {selectedTemplate.theme.fonts.heading}</span>
                        <span className="text-border">|</span>
                        <span>Body: {selectedTemplate.theme.fonts.body}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">Radius</h4>
                      <p className="text-sm text-muted-foreground">{selectedTemplate.theme.radius}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedTemplate.page && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layout className="h-4 w-4" />
                      Page structure
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <span className="text-muted-foreground">Title:</span>{" "}
                        <span className="font-medium">{selectedTemplate.page.title}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Slug:</span>{" "}
                        <span className="font-medium">{selectedTemplate.page.slug}</span>
                      </div>
                    </div>
                    <div>
                      <h4 className="mb-2 text-sm font-semibold">Sections</h4>
                      <ol className="list-decimal pl-4 text-sm text-muted-foreground">
                        {selectedTemplate.page.sections.map((section) => (
                          <li key={section.id}>
                            <span className="font-medium text-foreground">{section.type}</span>
                            <span className="text-xs"> ({section.id})</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedTemplate.placeholders && selectedTemplate.placeholders.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <List className="h-4 w-4" />
                      Placeholders
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Key</th>
                            <th className="px-3 py-2 text-left font-medium">Label</th>
                            <th className="px-3 py-2 text-left font-medium">Section</th>
                            <th className="px-3 py-2 text-left font-medium">Original</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selectedTemplate.placeholders.map((placeholder) => (
                            <tr key={placeholder.key}>
                              <td className="px-3 py-2 font-mono text-xs">{placeholder.key}</td>
                              <td className="px-3 py-2">{placeholder.label}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">{placeholder.sectionId}</td>
                              <td className="px-3 py-2 text-xs text-muted-foreground">
                                {placeholder.originalValue ?? "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Created {formatDate(selectedTemplate.createdAt)}</span>
                <span>Updated {formatDate(selectedTemplate.updatedAt)}</span>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setSelectedTemplate(null)}>
                Close
              </Button>
              <Button onClick={() => openCreateSite(selectedTemplate)}>
                Create site from template
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={createSiteOpen} onOpenChange={setCreateSiteOpen}>
        <DialogContent className="max-w-md">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold">Create site from template</h2>
            <DialogClose onClick={() => setCreateSiteOpen(false)} />
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm font-medium">Site name</label>
              <Input
                value={siteName}
                onChange={(e) => setSiteName(e.target.value)}
                placeholder={selectedTemplate ? deriveSiteName(selectedTemplate) : "Site name"}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Slug</label>
              <Input
                value={siteSlug}
                onChange={(e) => setSiteSlug(e.target.value)}
                placeholder={selectedTemplate ? deriveSiteSlug(selectedTemplate) : "site-slug"}
              />
            </div>
          </div>
          <div className="mt-6 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateSiteOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => selectedTemplate && createSite.mutate(selectedTemplate)}
              disabled={createSite.isPending || !selectedTemplate}
            >
              {createSite.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create site
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
