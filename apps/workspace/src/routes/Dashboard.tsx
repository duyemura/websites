import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LayoutGrid, List, Plus, Search, Loader2, Activity, Copy, X } from "lucide-react";
import { api, type Site } from "@/lib/api";
import { useNavigate, Link } from "react-router";

type ViewMode = "grid" | "list";

type PendingSite = Omit<Site, "status"> & { status: "cloning" };

type DashboardSite = Site | PendingSite;

function formatRelativeDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function getSiteDomain(site: DashboardSite): string {
  if (site.customDomain) return site.customDomain;
  if (site.subdomain) return `${site.subdomain}.pushpress.build`;
  return `${site.slug}.pushpress.build`;
}

function SiteThumbnail({ className }: { className?: string }) {
  return (
    <div
      className={className}
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--border)) 100%)",
      }}
    />
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [showNewSite, setShowNewSite] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [siteName, setSiteName] = useState("");
  const [isMyWebsite, setIsMyWebsite] = useState(false);
  const [hasRights, setHasRights] = useState(false);
  const [pendingClones, setPendingClones] = useState<PendingSite[]>([]);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: api.getSites,
  });

  const createSite = useMutation({
    mutationFn: async ({
      url,
      name,
    }: {
      url: string;
      name?: string;
    }) => {
      const scrapeResult = await api.scrapeSite({ url, name });
      const generateResult = await api.generateSite(scrapeResult.site.uuid, {
        mode: "replication",
        accuracy: "accurate",
      });
      return { site: scrapeResult.site, aiJobUuid: generateResult.aiJobUuid };
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["docs"] });
      setPendingClones((prev) =>
        prev.filter((s) => s.sourceUrl !== variables.url),
      );
      navigate(`/build/${result.site.uuid}?job=${result.aiJobUuid}`);
    },
    onError: (error, variables) => {
      setPendingClones((prev) =>
        prev.filter((s) => s.sourceUrl !== variables.url),
      );
      try {
        const body = JSON.parse(error.message.replace(/^\d+:\s*/, ""));
        setCloneError(body.error || error.message);
      } catch {
        setCloneError(error.message);
      }
    },
  });

  const filteredSites = useMemo(() => {
    let list: DashboardSite[] = [...(sites ?? []), ...pendingClones];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (site) =>
          site.name.toLowerCase().includes(q) ||
          site.slug.toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [sites, pendingClones, search]);

  const handleCreate = () => {
    if (!siteUrl.trim()) return;
    const url = siteUrl.trim();
    const name = siteName.trim() || undefined;

    const tempSlug = `cloning-${Date.now()}`;
    const pending: PendingSite = {
      uuid: tempSlug,
      workspaceUuid: "",
      slug: tempSlug,
      name: name || url,
      status: "cloning",
      sourceUrl: url,
      mode: "replication",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setPendingClones((prev) => [pending, ...prev]);
    setShowNewSite(false);
    setSiteUrl("");
    setSiteName("");
    setIsMyWebsite(false);
    setHasRights(false);
    createSite.reset();
    createSite.mutate({ url, name });
  };

  const canSubmit = siteUrl.trim() && (!isMyWebsite || hasRights);

  const resetModal = () => {
    setShowNewSite(false);
    setSiteUrl("");
    setSiteName("");
    setIsMyWebsite(false);
    setHasRights(false);
    createSite.reset();
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
        <div className="flex items-center gap-3">
          {import.meta.env.DEV && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/settings/ai-activity" className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                AI activity
              </Link>
            </Button>
          )}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search sites…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-64 pl-9"
            />
          </div>
          <div className="flex items-center rounded-md border">
            <button
              onClick={() => setView("grid")}
              className={`rounded-l-md p-2 ${
                view === "grid"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              title="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("list")}
              className={`rounded-r-md p-2 ${
                view === "list"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent"
              }`}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>
          <Button size="sm" onClick={() => setShowNewSite(true)}>
            <Plus className="h-4 w-4" />
            New site
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {cloneError && (
          <div className="mb-4 flex items-start justify-between rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-destructive">{cloneError}</p>
            <button
              type="button"
              onClick={() => setCloneError(null)}
              className="ml-3 text-destructive hover:text-destructive/80"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <Dialog
          open={showNewSite}
          onOpenChange={(open) => {
            if (!open) resetModal();
          }}
          className="max-w-lg"
        >
          <DialogContent className="gap-0 p-0">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">Create a New Site</h2>
              <DialogClose onClick={resetModal} />
            </div>

            <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
              <div className="flex flex-col gap-2">
                <label htmlFor="new-site-url" className="text-sm font-medium">
                  Source website URL
                </label>
                <Input
                  id="new-site-url"
                  type="url"
                  placeholder="https://example-gym.com"
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) handleCreate();
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  We will use this site as the starting point for your new site.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="new-site-name" className="text-sm font-medium">
                  Site name
                </label>
                <Input
                  id="new-site-name"
                  placeholder="Optional — we will derive one from the URL"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmit) handleCreate();
                  }}
                />
              </div>

              <div className="flex flex-col gap-3 rounded-md border bg-muted/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">This is my website</span>
                  <Switch
                    checked={isMyWebsite}
                    onCheckedChange={setIsMyWebsite}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  {isMyWebsite
                    ? "We will scrape your existing site, create workspace docs, and build a new homepage you can approve."
                    : "We will use this site as a template and generate a fresh design inspired by its layout."}
                </p>

                {isMyWebsite && (
                  <div className="mt-1 flex items-start gap-3">
                    <Checkbox
                      id="rights-confirm"
                      checked={hasRights}
                      onCheckedChange={setHasRights}
                      className="mt-0.5"
                    />
                    <label htmlFor="rights-confirm" className="text-sm leading-5">
                      I confirm I have the rights to clone and reuse the content from this website.
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t bg-card px-6 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={resetModal}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!canSubmit}
              >
                <Copy className="mr-2 h-4 w-4" />
                Create new site
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : filteredSites.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground">No sites yet. Create a new site to get started.</p>
          </div>
        ) : view === "list" ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSites.map((site) => (
                  <TableRow
                    key={site.uuid}
                    className={site.status === "cloning" ? "cursor-default" : "cursor-pointer"}
                    onClick={() => site.status !== "cloning" && navigate(`/sites/${site.uuid}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-sm font-semibold">
                          {site.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-medium">{site.name}</span>
                          {site.status === "cloning" && (
                            <p className="text-xs text-muted-foreground">Cloning from {site.sourceUrl}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {site.status === "cloning" ? (
                        <Badge variant="outline" className="gap-1 capitalize">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Cloning
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="capitalize">
                          {site.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {getSiteDomain(site)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {site.status === "cloning" ? "Just now" : formatRelativeDate(site.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredSites.map((site) => (
              <div
                key={site.uuid}
                className="overflow-hidden rounded-lg border bg-card"
              >
                <SiteThumbnail className="aspect-video w-full" />
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{site.name}</h3>
                    {site.status === "cloning" ? (
                      <Badge variant="outline" className="gap-1 capitalize">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Cloning
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="capitalize">
                        {site.status}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {site.status === "cloning" ? "Just now" : `Updated ${formatRelativeDate(site.updatedAt)}`}
                  </p>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">
                    {getSiteDomain(site)}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 w-full"
                    size="sm"
                    disabled={site.status === "cloning"}
                    onClick={() => site.status !== "cloning" && navigate(`/sites/${site.uuid}`)}
                  >
                    {site.status === "cloning" ? "Cloning…" : "Dashboard"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
