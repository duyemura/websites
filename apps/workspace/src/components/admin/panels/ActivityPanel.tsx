import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { LiveLogPanel } from "./LiveLogPanel";

interface ActivityPanelProps {
  siteUuid: string;
}

export function ActivityPanel({ siteUuid }: ActivityPanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["site-activity", siteUuid],
    queryFn: () => api.getSiteAiActivity(siteUuid, { limit: 50 }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-destructive">Failed to load activity: {error.message}</div>;

  const activities = data?.activities ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Cost summary</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <dl className="grid grid-cols-[150px_1fr] gap-1">
              <dt className="text-muted-foreground">Activities</dt>
              <dd>{summary.count}</dd>
              <dt className="text-muted-foreground">Total tokens</dt>
              <dd>{summary.totalTokens.toLocaleString()}</dd>
              <dt className="text-muted-foreground">Total cost</dt>
              <dd>${summary.totalCostUsd.toFixed(4)}</dd>
            </dl>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {activities.length === 0 && (
            <div className="text-sm text-muted-foreground">No AI activity recorded.</div>
          )}
          {activities.map((a) => (
            <div key={a.uuid} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{a.actionType}</span>
                <Badge variant={a.outcome === "success" ? "default" : "secondary"}>{a.outcome}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {a.model ?? "no model"} · {new Date(a.createdAt).toLocaleString()}
              </div>
              {a.summary && <p className="mt-1 text-xs">{a.summary}</p>}
              {(a.inputTokens ?? a.outputTokens) && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Tokens: {(a.inputTokens ?? 0).toLocaleString()} in / {(a.outputTokens ?? 0).toLocaleString()} out
                  {a.costUsd != null && ` · $${a.costUsd.toFixed(4)}`}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <LiveLogPanel siteUuid={siteUuid} />
    </div>
  );
}
