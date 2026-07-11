import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DocsPanelProps {
  siteUuid: string;
}

export function DocsPanel({ siteUuid }: DocsPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["site-docs", siteUuid],
    queryFn: () => api.getSiteDocs(siteUuid),
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-destructive">Failed to load docs: {error.message}</div>;

  const docs = data ?? [];
  const selected = docs.find((d) => d.key === selectedKey) ?? docs[0];

  return (
    <div className="grid gap-4 md:grid-cols-[280px_1fr]">
      <div className="space-y-1">
        {docs.map((doc) => (
          <button
            key={doc.key}
            onClick={() => setSelectedKey(doc.key)}
            className={cn(
              "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
              selected?.key === doc.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            <div className="font-medium">{doc.title}</div>
            <div
              className={cn(
                "text-xs",
                selected?.key === doc.key ? "text-primary-foreground/80" : "text-muted-foreground",
              )}
            >
              {doc.key} · <Badge variant={doc.status === "active" ? "default" : "secondary"}>{doc.status}</Badge>
            </div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{selected?.title ?? "Select a doc"}</CardTitle>
        </CardHeader>
        <CardContent>
          {selected?.content ? (
            <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap text-sm">
              {selected.content}
            </pre>
          ) : (
            <div className="text-muted-foreground">No content.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
