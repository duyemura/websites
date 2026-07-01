import { useMemo, useState } from "react";
import { useParams, Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { ArrowLeft, FileText, ExternalLink, Clock, Save, RefreshCw, Loader2, Activity } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogClose,
} from "@/components/ui/dialog";
import { BlockNoteEditor } from "@/components/BlockNoteEditor";
import {
  api,
  type Doc,
  type Deployment,
  type GenerateSiteResult,
  type ApprovePageResult,
} from "@/lib/api";

const DOC_CATEGORY_ORDER = [
  "workspace-memory",
  "site-memory",
  "brand-guidelines",
  "business-info",
  "site-strategy",
  "blueprint-draft",
];

const DOC_CATEGORY_LABELS: Record<string, string> = {
  "workspace-memory": "Workspace memory",
  "site-memory": "Site memory",
  "brand-guidelines": "Brand guidelines",
  "business-info": "Business info",
  "site-strategy": "Site strategy",
  "blueprint-draft": "Blueprint draft",
};

function getDocCategory(key: string): string {
  return DOC_CATEGORY_LABELS[key] ?? key;
}

function getDocCategoryRank(key: string): number {
  const index = DOC_CATEGORY_ORDER.indexOf(key);
  return index === -1 ? 999 : index;
}

function formatRelativeDate(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffSec < 5) return "just now";
  if (diffMin < 1) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 0) {
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `today at ${time}`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export function SiteDetail() {
  const { uuid } = useParams<{ uuid: string }>();
  const queryClient = useQueryClient();
  const [editingDoc, setEditingDoc] = useState<Doc | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [approvedMessage, setApprovedMessage] = useState<string | null>(null);

  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ["sites", uuid],
    queryFn: () => api.getSite(uuid!),
    enabled: !!uuid,
  });

  const { data: siteDocs, isLoading: siteDocsLoading } = useQuery({
    queryKey: ["sites", uuid, "docs"],
    queryFn: () => api.getSiteDocs(uuid!),
    enabled: !!uuid,
  });

  const { data: workspaceDocs, isLoading: workspaceDocsLoading } = useQuery({
    queryKey: ["docs"],
    queryFn: () => api.getDocs(),
  });

  const { data: deployments } = useQuery({
    queryKey: ["sites", uuid, "deployments"],
    queryFn: () => api.listDeployments(uuid!),
    enabled: !!uuid,
    refetchInterval: 5000,
  });

  const { data: buildActivity } = useQuery({
    queryKey: ["sites", uuid, "ai-activity", "generate"],
    queryFn: () =>
      api.getSiteAiActivity(uuid!, { actionType: "generate", limit: 20 }),
    enabled: !!uuid,
  });

  const saveDoc = useMutation({
    mutationFn: ({ key, body }: { key: string; body: { title: string; content: string } }) =>
      api.saveDoc(key, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites", uuid, "docs"] });
      queryClient.invalidateQueries({ queryKey: ["docs"] });
      queryClient.invalidateQueries({ queryKey: ["sites", uuid] });
    },
  });

  const generateSite = useMutation<GenerateSiteResult, Error, void>({
    mutationFn: () =>
      api.generateSite(uuid!, { mode: "replication", accuracy: "accurate" }),
    onSuccess: () => {
      setApprovedMessage(null);
      queryClient.invalidateQueries({
        queryKey: ["sites", uuid, "deployments"],
      });
    },
  });

  const approveHomepage = useMutation<ApprovePageResult, Error, void>({
    mutationFn: () => api.approvePage(site!.uuid, "index"),
    onSuccess: () => {
      setApprovedMessage("Approved — remaining pages queued.");
      queryClient.invalidateQueries({
        queryKey: ["sites", uuid, "deployments"],
      });
      queryClient.invalidateQueries({
        queryKey: ["sites", uuid, "docs"],
      });
      queryClient.invalidateQueries({ queryKey: ["sites", uuid] });
    },
  });

  const latestDeployment = useMemo<Deployment | null>(() => {
    if (!deployments?.length) return null;
    return [...deployments].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
  }, [deployments]);

  const sortedWorkspaceDocs = useMemo(() => {
    if (!workspaceDocs || !uuid) return [];
    return [...workspaceDocs]
      .filter((d) => !d.siteUuid)
      .sort((a, b) => getDocCategoryRank(a.key) - getDocCategoryRank(b.key));
  }, [workspaceDocs, uuid]);

  const sortedSiteDocs = useMemo(() => {
    if (!siteDocs) return [];
    return [...siteDocs]
      .filter((d) => d.siteUuid === uuid)
      .sort((a, b) => getDocCategoryRank(a.key) - getDocCategoryRank(b.key));
  }, [siteDocs, uuid]);


  const isLoading = siteLoading || siteDocsLoading || workspaceDocsLoading;

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col p-6">
        <Skeleton className="mb-4 h-8 w-48" />
        <Skeleton className="mb-6 h-4 w-96" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (!site) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center p-6">
        <p className="text-muted-foreground">Site not found.</p>
        <Button className="mt-4" asChild>
          <Link to="/">Back to sites</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Sites
            </Link>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">{site.name}</h1>
            <p className="text-sm text-muted-foreground">
              {site.slug} · {" "}
              <Badge variant="secondary" className="capitalize">
                {site.status}
              </Badge>
            </p>
          </div>
        </div>
        {import.meta.env.DEV && (
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/settings/ai-activity?siteUuid=${site.uuid}`} className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              AI activity
            </Link>
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        {(site.mode === "replication" || site.sourceUrl) && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Site build
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => generateSite.mutate()}
                    disabled={generateSite.isPending}
                  >
                    {generateSite.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Build homepage
                  </Button>
                  {approvedMessage && (
                    <p className="text-sm text-muted-foreground">
                      {approvedMessage}
                    </p>
                  )}
                </div>

                {latestDeployment && (
                  <div className="rounded-md border bg-muted/50 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant="outline" className="capitalize">
                        {latestDeployment.status}
                      </Badge>
                      {latestDeployment.previewUrl && (
                        <a
                          href={api.previewUrl(
                            site.uuid,
                            latestDeployment.buildId,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          Open preview
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {(latestDeployment.status === "ready" ||
                        latestDeployment.status === "success") &&
                        !approvedMessage && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => approveHomepage.mutate()}
                            disabled={approveHomepage.isPending}
                          >
                            {approveHomepage.isPending && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Approve homepage
                          </Button>
                        )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Build {latestDeployment.buildId} ·{" "}
                      {formatRelativeDate(latestDeployment.createdAt)}
                    </p>
                  </div>
                )}

                {deployments && deployments.length > 1 && (
                  <div>
                    <h4 className="mb-2 text-sm font-medium">Deployments</h4>
                    <ul className="space-y-1 text-sm">
                      {deployments.map((deployment) => (
                        <li
                          key={deployment.uuid}
                          className="flex items-center justify-between rounded-md border px-3 py-2"
                        >
                          <span className="font-mono text-xs">
                            {deployment.buildId}
                          </span>
                          <Badge variant="outline" className="capitalize">
                            {deployment.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {buildActivity && (
                  <div className="rounded-md border bg-muted/50 p-3">
                    <p className="text-sm font-medium">
                      Latest build cost/activity
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {buildActivity.summary.count} activities · $
                      {buildActivity.summary.totalCostUsd.toFixed(2)}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {(sortedWorkspaceDocs.length > 0 || sortedSiteDocs.length > 0) && (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[35%]">Doc</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedWorkspaceDocs.length > 0 && (
                  <>
                    <TableRow className="bg-muted/50">
                      <TableCell colSpan={4}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">Workspace docs</span>
                          <Badge variant="outline" className="text-xs">Workspace scope</Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                    {sortedWorkspaceDocs.map((doc) => (
                      <DocTableRow
                        key={doc.key}
                        doc={doc}
                        scope="workspace"
                        onClick={() => {
                          setEditingDoc(doc);
                          setEditTitle(doc.title);
                          setEditContent(doc.content ?? "");
                        }}
                      />
                    ))}
                  </>
                )}
                {sortedSiteDocs.length > 0 && (
                  <>
                    <TableRow className="bg-muted/50">
                      <TableCell colSpan={4}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold">Site docs</span>
                          <Badge variant="secondary" className="text-xs">Site scope</Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                    {sortedSiteDocs.map((doc) => (
                      <DocTableRow
                        key={doc.key}
                        doc={doc}
                        scope="site"
                        onClick={() => {
                          setEditingDoc(doc);
                          setEditTitle(doc.title);
                          setEditContent(doc.content ?? "");
                        }}
                      />
                    ))}
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {editingDoc && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) {
                setEditingDoc(null);
                setEditContent("");
                setEditTitle("");
              }
            }}
          >
            <DialogContent className="flex h-[calc(100vh-3rem)] max-w-6xl flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b px-6 py-4">
                <div className="flex-1 pr-4">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="h-10 text-lg font-semibold"
                    placeholder="Doc title"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      saveDoc.mutate(
                        {
                          key: editingDoc.key,
                          body: { title: editTitle, content: editContent },
                        },
                        {
                          onSuccess: () => {
                            setEditingDoc(null);
                            setEditContent("");
                            setEditTitle("");
                          },
                        },
                      )
                    }
                    disabled={saveDoc.isPending || !editTitle.trim()}
                  >
                    {saveDoc.isPending ? (
                      <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save changes
                  </Button>
                  <DialogClose
                    onClick={() => {
                      setEditingDoc(null);
                      setEditContent("");
                      setEditTitle("");
                    }}
                  />
                </div>
              </div>
              {saveDoc.isError && (
                <p className="px-6 py-2 text-sm text-destructive">
                  {saveDoc.error?.message}
                </p>
              )}
              {editingDoc.key === "brand-guidelines" && (
                <div className="px-6 pt-4">
                  <BrandGuidelinesSwatches content={editContent} />
                </div>
              )}
              <div className="flex-1 overflow-hidden p-6">
                <div className="flex h-full flex-col rounded-md border">
                  <BlockNoteEditor
                    content={editContent}
                    onChange={setEditContent}
                  />
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}

interface BrandColor {
  role: string;
  token: string;
  hex: string;
  usage: string;
}

function parseBrandColors(content: string): BrandColor[] {
  const lines = content.split("\n");
  const colors: BrandColor[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    const hexCell = cells.find((c) => /^#?[0-9A-Fa-f]{6}$/.test(c.replace(/`/g, "")));
    if (!hexCell) continue;
    const hex = hexCell.replace(/`/g, "").startsWith("#")
      ? hexCell.replace(/`/g, "")
      : `#${hexCell.replace(/`/g, "")}`;
    const role = cells[0]?.replace(/\*\*/g, "").trim() ?? "";
    const token = cells[1]?.replace(/`/g, "").trim() ?? "";
    const usage = cells[3]?.replace(/\*\*/g, "").trim() ?? "";
    colors.push({ role, token, hex, usage });
  }
  return colors;
}

function BrandGuidelinesSwatches({ content }: { content: string }) {
  const colors = useMemo(() => parseBrandColors(content), [content]);
  if (colors.length === 0) return null;

  return (
    <div className="rounded-md border p-4">
      <h3 className="mb-3 text-sm font-semibold">Color palette</h3>
      <div className="flex flex-wrap gap-4">
        {colors.map((color, index) => (
          <div key={`${color.token}-${index}`} className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-md border shadow-sm"
              style={{ backgroundColor: color.hex }}
              title={color.hex}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{color.role || color.token}</p>
              <p className="text-xs text-muted-foreground">
                {color.token} · {color.hex}
              </p>
              {color.usage && (
                <p className="max-w-[200px] truncate text-xs text-muted-foreground">
                  {color.usage}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocTableRow({
  doc,
  scope,
  onClick,
}: {
  doc: Doc;
  scope: "workspace" | "site";
  onClick: () => void;
}) {
  return (
    <TableRow className="cursor-pointer" onClick={onClick}>
      <TableCell>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-medium">{getDocCategory(doc.key)}</p>
            <p className="line-clamp-1 text-sm text-muted-foreground">
              {doc.content?.slice(0, 80).replace(/#|>/g, "") ?? "No content yet."}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs capitalize">
          {doc.source.replace("_", " ")}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        <span className="flex items-center gap-1.5 text-sm">
          <Clock className="h-3.5 w-3.5" />
          {formatRelativeDate(doc.updatedAt)}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <Badge variant={scope === "workspace" ? "outline" : "secondary"} className="text-xs">
          {scope === "workspace" ? "Workspace" : "Site"}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
