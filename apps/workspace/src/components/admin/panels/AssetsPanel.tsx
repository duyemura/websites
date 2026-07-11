import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AssetsPanelProps {
  siteUuid: string;
}

export function AssetsPanel({ siteUuid }: AssetsPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["assets", siteUuid],
    queryFn: () => api.getAssets(),
  });
  const [filter, setFilter] = useState<string | "all">("all");

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-destructive">Failed to load assets: {error.message}</div>;

  const assets = data ?? [];
  const types = Array.from(new Set(assets.map((a) => a.type)));
  const filtered = filter === "all" ? assets : assets.filter((a) => a.type === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-md px-3 py-1 text-xs transition-colors",
            filter === "all" ? "bg-primary text-primary-foreground" : "border hover:bg-muted",
          )}
        >
          All
        </button>
        {types.map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={cn(
              "rounded-md px-3 py-1 text-xs capitalize transition-colors",
              filter === type ? "bg-primary text-primary-foreground" : "border hover:bg-muted",
            )}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((asset) => (
          <Card key={asset.uuid} className="overflow-hidden">
            <CardContent className="p-3">
              <div className="mb-2 aspect-video overflow-hidden rounded bg-muted">
                {asset.type === "image" || asset.type === "logo" ? (
                  <img
                    src={asset.signedUrl || asset.url}
                    alt={asset.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    {asset.type}
                  </div>
                )}
              </div>
              <div className="text-sm font-medium truncate">{asset.name}</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{asset.type}</Badge>
                <span>{asset.source}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
