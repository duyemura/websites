import { useMemo } from "react";
import { useParams, Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, FileText, Image, ExternalLink } from "lucide-react";
import { api, type Doc } from "@/lib/api";

const DOC_CATEGORY_ORDER = [
  "workspace-memory",
  "site-memory",
  "brand-guidelines",
  "business-info",
  "site-structure",
  "generation-plan",
  "blueprint-draft",
  "team-bios",
  "testimonials",
  "faqs",
];

const DOC_CATEGORY_LABELS: Record<string, string> = {
  "workspace-memory": "Workspace memory",
  "site-memory": "Site memory",
  "brand-guidelines": "Brand guidelines",
  "business-info": "Business info",
  "site-structure": "Site structure",
  "generation-plan": "Generation plan",
  "blueprint-draft": "Blueprint draft",
  "team-bios": "Team bios",
  testimonials: "Testimonials",
  faqs: "FAQs",
};

function getDocCategory(key: string): string {
  return DOC_CATEGORY_LABELS[key] ?? key;
}

function getDocCategoryRank(key: string): number {
  const index = DOC_CATEGORY_ORDER.indexOf(key);
  return index === -1 ? 999 : index;
}

export function SiteDetail() {
  const { uuid } = useParams<{ uuid: string }>();
  const [searchParams] = useSearchParams();
  const openDocKey = searchParams.get("doc") ?? undefined;

  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ["sites", uuid],
    queryFn: () => api.getSite(uuid!),
    enabled: !!uuid,
  });

  const { data: docs, isLoading: docsLoading } = useQuery({
    queryKey: ["sites", uuid, "docs"],
    queryFn: () => api.getSiteDocs(uuid!),
    enabled: !!uuid,
  });

  const screenshotDoc = useMemo(() => {
    if (!docs) return null;
    const brand = docs.find((d) => d.key === "brand-guidelines");
    if (!brand?.content) return null;
    const match = brand.content.match(/!\[.*?\]\(([^)]+)\)/);
    return match?.[1] ?? null;
  }, [docs]);

  const sortedDocs = useMemo(() => {
    if (!docs) return [];
    return [...docs].sort((a, b) => getDocCategoryRank(a.key) - getDocCategoryRank(b.key));
  }, [docs]);

  const openDoc = useMemo(() => {
    if (!openDocKey || !docs) return null;
    return docs.find((d) => d.key === openDocKey) ?? null;
  }, [openDocKey, docs]);

  if (siteLoading || docsLoading) {
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

  if (!site || !docs) {
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
      </header>

      <div className="flex-1 overflow-auto p-6">
        {screenshotDoc && (
          <Card className="mb-6 overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Image className="h-4 w-4" />
                Screenshot
              </CardTitle>
            </CardHeader>
            <CardContent>
              <a
                href={screenshotDoc}
                target="_blank"
                rel="noreferrer"
                className="group relative block aspect-video overflow-hidden rounded-md border bg-muted"
              >
                <img
                  src={screenshotDoc}
                  alt={`Screenshot of ${site.name}`}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute right-2 top-2 rounded-md bg-background/90 p-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <ExternalLink className="h-4 w-4" />
                </div>
              </a>
            </CardContent>
          </Card>
        )}

        <h2 className="mb-4 text-lg font-semibold">Generated docs</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sortedDocs.map((doc) => (
            <DocCard key={doc.key} doc={doc} />
          ))}
        </div>

        {openDoc && (
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">
              Preview: {openDoc.title}
            </h2>
            <Card>
              <CardContent className="p-6">
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
                  {openDoc.content}
                </pre>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function DocCard({ doc }: { doc: Doc }) {
  const previewLink = `/sites/${doc.siteUuid}?doc=${doc.key}`;

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-muted-foreground" />
          {getDocCategory(doc.key)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
          {doc.content?.slice(0, 160).replace(/#|>/g, "") ?? "No content yet."}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Badge variant="outline" className="text-xs capitalize">
            {doc.source.replace("_", " ")}
          </Badge>
          <Button variant="ghost" size="sm" className="ml-auto" asChild>
            <Link to={previewLink}>Preview</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/docs?doc=${doc.key}`}>Open in docs</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
