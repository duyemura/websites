import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SiteListProps {
  selectedSiteUuid: string | null;
  onSelect: (uuid: string) => void;
  onNewSite: () => void;
  onOpenChat?: () => void;
}

export function SiteList({ selectedSiteUuid, onSelect, onNewSite, onOpenChat }: SiteListProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["sites"],
    queryFn: () => api.getSites(),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load sites: {error.message}
        <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const sites = data ?? [];

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Sites
        </h2>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenChat}
            disabled={!selectedSiteUuid}
            title="Open AI chat for the selected site"
          >
            AI chat
          </Button>
          <Button size="sm" onClick={onNewSite}>New</Button>
        </div>
      </div>
      <div className="space-y-1">
        {sites.length === 0 && (
          <div className="px-2 text-sm text-muted-foreground">No sites in this workspace.</div>
        )}
        {sites.map((site) => (
          <button
            key={site.uuid}
            onClick={() => onSelect(site.uuid)}
            className={cn(
              "w-full rounded-md px-2 py-2 text-left text-sm transition-colors",
              selectedSiteUuid === site.uuid
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            <div className="font-medium">{site.name}</div>
            <div className={cn(
              "text-xs",
              selectedSiteUuid === site.uuid ? "text-primary-foreground/80" : "text-muted-foreground",
            )}>
              /{site.slug} · {site.status} · {site.mode ?? "no mode"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
