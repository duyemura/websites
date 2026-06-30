import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { Activity } from "lucide-react";

interface AiActivityItem {
  uuid: string;
  workspaceUuid: string;
  siteUuid: string | null;
  userUuid: string;
  aiJobUuid: string | null;
  actionType: string;
  model: string | null;
  provider: string | null;
  promptTemplateKeys: string | null;
  inputDocKeys: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  outcome: string;
  fidelityScore: number | null;
  summary: string;
  errorMessage: string | null;
  userCorrection: string | null;
  metadata: unknown;
  createdAt: string;
}

interface AiActivityResponse {
  activities: AiActivityItem[];
  summary: {
    totalCostUsd: number;
    totalTokens: number;
    count: number;
  };
}

const OUTCOME_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  success: "default",
  partial: "secondary",
  failure: "outline",
  user_edited: "secondary",
  rejected: "outline",
};

function formatCurrency(value: number): string {
  if (value === 0) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function AiActivity() {
  const [limit] = useState(100);
  const { data, isLoading, error } = useQuery<AiActivityResponse>({
    queryKey: ["ai-activity", limit],
    queryFn: () => api.getAiActivity(limit),
  });

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI activity</h1>
          <p className="text-muted-foreground">Token usage and cost history for this workspace.</p>
        </div>
      </div>

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="mt-8 text-destructive">Failed to load activity: {error.message}</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total cost</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(data?.summary.totalCostUsd ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total tokens</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatTokens(data?.summary.totalTokens ?? 0)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Operations</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatTokens(data?.summary.count ?? 0)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Recent activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Input</TableHead>
                      <TableHead className="text-right">Output</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Latency</TableHead>
                      <TableHead>Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data?.activities.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground">
                          No AI activity recorded yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      data?.activities.map((activity) => (
                        <TableRow key={activity.uuid}>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDate(activity.createdAt)}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium">{activity.actionType}</p>
                              <p className="max-w-xs truncate text-xs text-muted-foreground" title={activity.summary}>
                                {activity.summary}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            {activity.model ? (
                              <div>
                                <p className="font-medium">{activity.model}</p>
                                {activity.provider && (
                                  <p className="text-xs text-muted-foreground">{activity.provider}</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {activity.inputTokens != null ? formatTokens(activity.inputTokens) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {activity.outputTokens != null ? formatTokens(activity.outputTokens) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {activity.costUsd != null ? formatCurrency(activity.costUsd) : "—"}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDuration(activity.latencyMs)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={OUTCOME_VARIANTS[activity.outcome] ?? "outline"} className="capitalize">
                              {activity.outcome}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
