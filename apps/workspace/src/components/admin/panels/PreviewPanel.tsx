import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

interface PreviewPanelProps {
  siteUuid: string;
}

export function PreviewPanel({ siteUuid }: PreviewPanelProps) {
  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ["site", siteUuid],
    queryFn: () => api.getSite(siteUuid),
  });
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["pipeline-status", siteUuid],
    queryFn: () => api.getPipelineStatus(siteUuid),
  });

  const isLoading = siteLoading || statusLoading;
  const hasBuild = status?.stages?.build != null;
  const previewUrl = site?.previewUrl ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center p-6">
            <Skeleton className="h-32 w-32" />
          </div>
        ) : !previewUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <p>No preview URL configured.</p>
            <p>Set MILO_PREVIEW_DOMAIN in the API environment to enable previews.</p>
          </div>
        ) : !hasBuild ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <p>No build available yet.</p>
            <p>Run the pipeline from the Run tab to generate a preview.</p>
          </div>
        ) : (
          <iframe
            src={previewUrl}
            title="Site preview"
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin"
          />
        )}
      </div>
    </div>
  );
}
