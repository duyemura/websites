import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OverviewPanel } from "./panels/OverviewPanel";
import { PipelinePanel } from "./panels/PipelinePanel";
import { RunConfigPanel } from "./panels/RunConfigPanel";
import { ArtifactsPanel } from "./panels/ArtifactsPanel";
import { DocsPanel } from "./panels/DocsPanel";
import { AssetsPanel } from "./panels/AssetsPanel";
import { FilesPanel } from "./panels/FilesPanel";
import { MirrorPanel } from "./panels/MirrorPanel";
import { ActivityPanel } from "./panels/ActivityPanel";
import { PreviewPanel } from "./panels/PreviewPanel";
import { SiteEventsProvider } from "./SiteEventsProvider";

const TABS = [
  { key: "preview", label: "Preview" },
  { key: "overview", label: "Overview" },
  { key: "pipeline", label: "Pipeline" },
  { key: "artifacts", label: "Artifacts" },
  { key: "docs", label: "Docs" },
  { key: "assets", label: "Assets" },
  { key: "files", label: "Files" },
  { key: "mirror", label: "Mirror" },
  { key: "activity", label: "Activity" },
  { key: "run", label: "Run" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

interface SiteDetailProps {
  siteUuid: string;
  initialTab?: TabKey;
}

export function SiteDetail({ siteUuid, initialTab }: SiteDetailProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab ?? "preview");

  const { data: site, isLoading } = useQuery({
    queryKey: ["site", siteUuid],
    queryFn: () => api.getSite(siteUuid),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!site) {
    return <div className="text-muted-foreground">Site not found.</div>;
  }

  const previewUrl = site.previewUrl;

  return (
    <SiteEventsProvider siteUuid={siteUuid}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{site.name}</h1>
            <p className="text-sm text-muted-foreground">
              {site.sourceUrl ?? "No source URL"} · {site.status} · {site.mode ?? "no mode"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {previewUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  window.open(previewUrl, "_blank", "noopener,noreferrer")
                }
              >
                Preview site
              </Button>
            )}
            <Button size="sm" onClick={() => setActiveTab("run")}>Configure run</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b pb-2">
          {TABS.map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={cn(activeTab === tab.key && "pointer-events-none")}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div className="min-h-[400px]">
          {activeTab === "preview" && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium">Site preview</h2>
              <div className="h-[calc(100vh-13rem)]">
                <PreviewPanel siteUuid={siteUuid} />
              </div>
            </div>
          )}
          {activeTab === "overview" && <OverviewPanel siteUuid={siteUuid} />}
          {activeTab === "pipeline" && <PipelinePanel siteUuid={siteUuid} />}
          {activeTab === "run" && <RunConfigPanel siteUuid={siteUuid} />}
          {activeTab === "artifacts" && <ArtifactsPanel siteUuid={siteUuid} />}
          {activeTab === "docs" && <DocsPanel siteUuid={siteUuid} />}
          {activeTab === "assets" && <AssetsPanel siteUuid={siteUuid} />}
          {activeTab === "files" && <FilesPanel siteUuid={siteUuid} />}
          {activeTab === "mirror" && <MirrorPanel siteUuid={siteUuid} />}
          {activeTab === "activity" && <ActivityPanel siteUuid={siteUuid} />}
        </div>
      </div>
    </SiteEventsProvider>
  );
}
