import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PipelinePanelProps {
  siteUuid: string;
}

const STAGES = ["extract", "segment", "contract", "docgen", "build", "verify"] as const;

export function PipelinePanel({ siteUuid }: PipelinePanelProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pipeline-status", siteUuid],
    queryFn: () => api.getPipelineStatus(siteUuid),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <div className="text-destructive">Failed to load status: {error.message}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stage status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {STAGES.map((stage) => {
              const status = data.stages[stage];
              return (
                <div
                  key={stage}
                  className={cn(
                    "rounded-lg border p-3 text-sm",
                    status?.stale && "border-amber-500/50 bg-amber-50",
                  )}
                >
                  <div className="font-medium capitalize">{stage}</div>
                  {status ? (
                    <>
                      <div className="text-xs text-muted-foreground">
                        v{status.version}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(status.createdAt).toLocaleString()}
                      </div>
                      {status.stale && <Badge variant="outline">stale</Badge>}
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">Not run</div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {data.scores && (
        <Card>
          <CardHeader>
            <CardTitle>Latest scores</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[150px_1fr] gap-1 text-sm">
              <dt className="text-muted-foreground">Mechanical fidelity</dt>
              <dd>{data.scores.mechanicalFidelity.toFixed(1)}%</dd>
              <dt className="text-muted-foreground">Visual fidelity</dt>
              <dd>{data.scores.visualFidelity.toFixed(1)}%</dd>
              <dt className="text-muted-foreground">Master fidelity</dt>
              <dd>{data.scores.masterFidelity.toFixed(1)}%</dd>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
