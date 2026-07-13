import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FilesPanelProps {
  siteUuid: string;
}

export function FilesPanel({ siteUuid }: FilesPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["site-files", siteUuid],
    queryFn: () => api.getSiteFiles(siteUuid),
  });
  const [filter, setFilter] = useState<string | "all">("all");

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-destructive">Failed to load files: {error.message}</div>;

  const files = data?.files ?? [];
  const types = Array.from(new Set(files.map((f) => f.type)));
  const filtered = filter === "all" ? files : files.filter((f) => f.type === filter);

  return (
    <Card>
      <CardHeader>
        <CardTitle>S3 files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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

        <div className="rounded border">
          <div className="grid grid-cols-[1fr_80px_120px] gap-2 border-b bg-muted px-3 py-2 text-xs font-medium">
            <span>Key</span>
            <span>Type</span>
            <span className="text-right">Size</span>
          </div>
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">No files found.</div>
          )}
          {filtered.map((file) => (
            <a
              key={file.key}
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="grid grid-cols-[1fr_80px_120px] gap-2 border-b px-3 py-2 text-xs last:border-b-0 hover:bg-muted"
            >
              <span className="break-all font-mono">{file.key}</span>
              <span><Badge variant="secondary">{file.type}</Badge></span>
              <span className="text-right text-muted-foreground">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
