import { useQuery } from "@tanstack/react-query";
import { api, type PipelineStageStatus } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

interface OverviewPanelProps {
  siteUuid: string;
}

export function OverviewPanel({ siteUuid }: OverviewPanelProps) {
  const { data: site, isLoading } = useQuery({
    queryKey: ["site", siteUuid],
    queryFn: () => api.getSite(siteUuid),
    staleTime: 0,
  });
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["pipeline-status", siteUuid],
    queryFn: () => api.getPipelineStatus(siteUuid),
    staleTime: 0,
  });
  const { data: aiActivity, isLoading: activityLoading } = useQuery({
    queryKey: ["site-activity", siteUuid],
    queryFn: () => api.getSiteAiActivity(siteUuid, { limit: 500 }),
    staleTime: 0,
  });

  if (isLoading || statusLoading || activityLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!site) return <div className="text-muted-foreground">Site not found.</div>;

  const latestStage = status
    ? (Object.entries(status.stages)
        .filter((entry): entry is [string, PipelineStageStatus] => entry[1] !== null)
        .sort((a, b) => new Date(b[1].createdAt).getTime() - new Date(a[1].createdAt).getTime())[0])
    : undefined;

  const costByAction = new Map<
    string,
    { count: number; inputTokens: number; outputTokens: number; costUsd: number }
  >();
  for (const activity of aiActivity?.activities ?? []) {
    const existing = costByAction.get(activity.actionType) ?? {
      count: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
    existing.count += 1;
    existing.inputTokens += activity.inputTokens ?? 0;
    existing.outputTokens += activity.outputTokens ?? 0;
    existing.costUsd += activity.costUsd ?? 0;
    costByAction.set(activity.actionType, existing);
  }
  const sortedActions = Array.from(costByAction.entries()).sort(
    (a, b) => b[1].costUsd - a[1].costUsd,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Site metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <dl className="grid grid-cols-[120px_1fr] gap-1">
              <dt className="text-muted-foreground">UUID</dt>
              <dd className="font-mono">{site.uuid}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd>/{site.slug}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd><Badge variant="secondary">{site.status}</Badge></dd>
              <dt className="text-muted-foreground">Mode</dt>
              <dd>{site.mode ?? "—"}</dd>
              <dt className="text-muted-foreground">Source URL</dt>
              <dd className="break-all">{site.sourceUrl ?? "—"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {latestStage ? (
              <>
                <p>
                  Latest stage: {" "}
                  <Badge>{latestStage[0]}</Badge>{" "}
                  <span className="text-muted-foreground">
                    {new Date(latestStage[1].createdAt).toLocaleString()}
                  </span>
                </p>
                {status?.scores && (
                  <dl className="grid grid-cols-[150px_1fr] gap-1">
                    <dt className="text-muted-foreground">Mechanical fidelity</dt>
                    <dd>{status.scores.mechanicalFidelity.toFixed(1)}%</dd>
                    <dt className="text-muted-foreground">Visual fidelity</dt>
                    <dd>{status.scores.visualFidelity.toFixed(1)}%</dd>
                    <dt className="text-muted-foreground">Master fidelity</dt>
                    <dd>{status.scores.masterFidelity.toFixed(1)}%</dd>
                  </dl>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">No pipeline artifacts yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI cost by action</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {sortedActions.length === 0 ? (
            <p className="text-muted-foreground">No AI activity recorded for this site.</p>
          ) : (
            <>
              <dl className="grid grid-cols-[180px_1fr_1fr_1fr] gap-x-2 gap-y-1 border-b pb-2 font-medium">
                <dt className="text-muted-foreground">Action</dt>
                <dd className="text-right">Activities</dd>
                <dd className="text-right">Tokens</dd>
                <dd className="text-right">Cost</dd>
              </dl>
              <div className="space-y-1">
                {sortedActions.map(([actionType, row]) => (
                  <dl
                    key={actionType}
                    className="grid grid-cols-[180px_1fr_1fr_1fr] gap-x-2 gap-y-1"
                  >
                    <dt className="font-medium">{actionType}</dt>
                    <dd className="text-right text-muted-foreground">{row.count.toLocaleString()}</dd>
                    <dd className="text-right text-muted-foreground">
                      {(row.inputTokens + row.outputTokens).toLocaleString()}
                    </dd>
                    <dd className="text-right">${row.costUsd.toFixed(4)}</dd>
                  </dl>
                ))}
              </div>
              {aiActivity?.summary && (
                <dl className="grid grid-cols-[180px_1fr_1fr_1fr] gap-x-2 gap-y-1 border-t pt-2 font-medium">
                  <dt>Total</dt>
                  <dd className="text-right">{aiActivity.summary.count.toLocaleString()}</dd>
                  <dd className="text-right">{aiActivity.summary.totalTokens.toLocaleString()}</dd>
                  <dd className="text-right">${aiActivity.summary.totalCostUsd.toFixed(4)}</dd>
                </dl>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
