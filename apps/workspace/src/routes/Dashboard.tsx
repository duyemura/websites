import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LayoutGrid, List, Plus, Search, Loader2, Link2, Activity, Copy } from "lucide-react";
import { api, type Site } from "@/lib/api";
import { useNavigate, Link } from "react-router";

type ViewMode = "grid" | "list";

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

function getSiteDomain(site: Site): string {
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
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [scrapeUrl, setScrapeUrl] = useState("");
  const [scrapeName, setScrapeName] = useState("");
  const [showScrape, setShowScrape] = useState(false);
  const [confirmScrape, setConfirmScrape] = useState<{
    siteUuid: string;
    status: string;
    message: string;
  } | null>(null);

  const { data: sites, isLoading } = useQuery({
    queryKey: ["sites"],
    queryFn: api.getSites,
  });

  const scrapeSite = useMutation({
    mutationFn: api.scrapeSite,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["docs"] });
      setScrapeUrl("");
      setScrapeName("");
      setShowScrape(false);
      setConfirmScrape(null);
      navigate(`/docs?site=${result.site.uuid}`);
    },
    onError: (error) => {
      try {
        const body = JSON.parse(error.message.replace(/^\d+:\s*/, ""));
        if (body.requiresConfirmation && body.siteUuid) {
          setConfirmScrape({
            siteUuid: body.siteUuid,
            status: body.status,
            message: body.error,
          });
          return;
        }
      } catch {
        // not our shaped error; let it surface normally
      }
    },
  });

  const cloneSite = useMutation({
    mutationFn: async ({
      url,
      name,
    }: {
      url: string;
      name?: string;
    }) => {
      const result = await api.scrapeSite({ url, name });
      await api.generateSite(result.site.uuid, {
        mode: "replication",
        accuracy: "accurate",
      });
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["docs"] });
      setCloneUrl("");
      setCloneName("");
      setShowNewSite(false);
      navigate(`/sites/${result.site.uuid}`);
    },
  });

  const filteredSites = useMemo(() => {
    let list = sites ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (site) =>
          site.name.toLowerCase().includes(q) ||
          site.slug.toLowerCase().includes(q),
      );
    }
    return list;
  }, [sites, search]);

  const handleScrape = (force?: boolean) => {
    if (!scrapeUrl.trim()) return;
    scrapeSite.mutate({
      url: scrapeUrl.trim(),
      name: scrapeName.trim() || undefined,
      force,
    });
  };

  const handleClone = () => {
    if (!cloneUrl.trim()) return;
    cloneSite.mutate({
      url: cloneUrl.trim(),
      name: cloneName.trim() || undefined,
    });
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
          <Button size="sm" onClick={() => setShowScrape(true)}>
            <Link2 className="h-4 w-4" />
            Scrape URL
          </Button>
          <Button size="sm" onClick={() => setShowNewSite(true)}>
            <Plus className="h-4 w-4" />
            New site
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {showScrape && (
          <div className="mb-6 rounded-lg border bg-card p-6">
            <h2 className="mb-2 font-semibold">Scrape a website</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Enter a gym or studio URL. We will scrape the homepage, create a site record, and generate workspace docs you can inspect.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="url"
                placeholder="https://example-gym.com"
                value={scrapeUrl}
                onChange={(e) => setScrapeUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleScrape();
                }}
              />
              <Input
                placeholder="Site name (optional)"
                value={scrapeName}
                onChange={(e) => setScrapeName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleScrape();
                }}
              />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => handleScrape()}
                disabled={scrapeSite.isPending || !scrapeUrl.trim()}
              >
                {scrapeSite.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                {scrapeSite.isPending ? "Scraping…" : "Scrape and create docs"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowScrape(false);
                  setScrapeUrl("");
                  setScrapeName("");
                  setConfirmScrape(null);
                  scrapeSite.reset();
                }}
                disabled={scrapeSite.isPending}
              >
                Cancel
              </Button>
              {scrapeSite.isError && !confirmScrape && (
                <p className="text-sm text-destructive">
                  {scrapeSite.error?.message.replace(/^\d+:\s*/, "")}
                </p>
              )}
            </div>

            {confirmScrape && (
              <div className="mt-4 rounded-md border border-destructive/50 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive">
                  {confirmScrape.message}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleScrape(true)}
                    disabled={scrapeSite.isPending}
                  >
                    {scrapeSite.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    Rescan and replace
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmScrape(null);
                      scrapeSite.reset();
                    }}
                    disabled={scrapeSite.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {showNewSite && (
          <div className="mb-6 rounded-lg border bg-card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold">Create a new site</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowNewSite(false);
                  setCloneUrl("");
                  setCloneName("");
                  cloneSite.reset();
                }}
              >
                Cancel
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col rounded-md border p-5">
                <h3 className="font-semibold">Clone my site</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">
                  Enter your current gym website URL. We'll scrape it, create docs,
                  and build a new homepage you can approve.
                </p>
                <div className="mt-4 grid gap-3">
                  <Input
                    type="url"
                    placeholder="https://example-gym.com"
                    value={cloneUrl}
                    onChange={(e) => setCloneUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleClone();
                    }}
                  />
                  <Input
                    placeholder="Site name (optional)"
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleClone();
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={handleClone}
                    disabled={cloneSite.isPending || !cloneUrl.trim()}
                  >
                    {cloneSite.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    {cloneSite.isPending ? "Cloning…" : "Clone my site"}
                  </Button>
                </div>
                {cloneSite.isError && (
                  <p className="mt-3 text-sm text-destructive">
                    {cloneSite.error?.message.replace(/^\d+:\s*/, "")}
                  </p>
                )}
              </div>

              <div className="flex flex-col rounded-md border p-5 opacity-75">
                <h3 className="font-semibold">Clone as template</h3>
                <p className="mt-1 flex-1 text-sm text-muted-foreground">
                  Coming soon — use any public gym site as a reusable template.
                </p>
                <div className="mt-4">
                  <Button size="sm" variant="outline" disabled className="w-full">
                    Choose template
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : filteredSites.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <p className="text-muted-foreground">No sites yet. Scrape or clone a site to get started.</p>
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
                    className="cursor-pointer"
                    onClick={() => navigate(`/sites/${site.uuid}`)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-sm font-semibold">
                          {site.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium">{site.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">
                        {site.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {getSiteDomain(site)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeDate(site.updatedAt)}
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
                  <h3 className="font-semibold">{site.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    Updated {formatRelativeDate(site.updatedAt)}
                  </p>
                  <p className="mt-1 font-mono text-sm text-muted-foreground">
                    {getSiteDomain(site)}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 w-full"
                    size="sm"
                    onClick={() => navigate(`/sites/${site.uuid}`)}
                  >
                    Dashboard
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
