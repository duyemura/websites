import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSiteEventsContext, type SiteEvent } from "../SiteEventsProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface LiveLogPanelProps {
  siteUuid: string;
}

interface LogLine {
  stream: "stdout" | "stderr";
  line: string;
  at: string;
}

interface RunGroup {
  key: string;
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  state: "running" | "completed" | "failed";
  currentStage: string | null;
  currentMessage: string | null;
  stages: string[];
  lines: LogLine[];
  error: string | null;
}

function formatTime(timestamp: string | null): string {
  if (!timestamp) return "";
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return timestamp;
  }
}

function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function deriveRunGroups(events: SiteEvent[]): RunGroup[] {
  const groups = new Map<string, RunGroup>();

  for (const event of events) {
    const jobId = event.jobId ?? null;
    const key = jobId ?? `no-job-${event.timestamp}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        jobId,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        state: "running",
        currentStage: null,
        currentMessage: null,
        stages: [],
        lines: [],
        error: null,
      };
      groups.set(key, group);
    }

    const payload = event.payload ?? {};
    switch (event.type) {
      case "pipeline.job.started":
        group.startedAt = event.timestamp;
        group.stages = Array.isArray(payload.stages) ? (payload.stages as string[]) : [];
        break;
      case "pipeline.job.completed":
        group.completedAt = event.timestamp;
        group.state = "completed";
        break;
      case "pipeline.job.failed":
        group.failedAt = event.timestamp;
        group.state = "failed";
        group.error = String(payload.error ?? "");
        break;
      case "pipeline.stage.started":
        group.currentStage = String(payload.stage ?? "");
        break;
      case "pipeline.stage.progress":
        group.currentMessage = String(payload.message ?? "");
        if (payload.stage && typeof payload.stage === "string") {
          group.currentStage = payload.stage;
        }
        break;
      case "pipeline.stage.log": {
        const incoming = payload.lines as LogLine[] | undefined;
        if (incoming && incoming.length > 0) {
          group.lines.push(...incoming);
        }
        break;
      }
      case "pipeline.stage.failed":
        group.failedAt = event.timestamp;
        group.state = "failed";
        group.error = String(payload.error ?? "");
        break;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime;
  });
}

function RunSummary({ group }: { group: RunGroup }) {
  const variant =
    group.state === "failed"
      ? "destructive"
      : group.state === "completed"
        ? "default"
        : "outline";

  return (
    <div className="flex flex-1 items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {group.jobId ? `Run ${group.jobId}` : "Run"}
          </span>
          <Badge variant={variant} className="text-[10px]">
            {group.state}
          </Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {group.currentStage ? `Stage: ${group.currentStage}` : "Waiting for stage…"}
          {group.currentMessage && (
            <span className="ml-2">· {group.currentMessage}</span>
          )}
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <div>{formatTime(group.startedAt)}</div>
        <div>{formatDuration(group.startedAt, group.completedAt ?? group.failedAt)}</div>
      </div>
    </div>
  );
}

function RunLog({ lines }: { lines: LogLine[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  if (lines.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground">
        No subprocess output captured yet.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="max-h-80 overflow-y-auto bg-black px-3 py-2 font-mono text-xs leading-relaxed"
    >
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap",
            line.stream === "stderr" ? "text-red-400" : "text-slate-200",
          )}
        >
          <span className="mr-2 select-none text-slate-500">
            {line.stream === "stderr" ? "!" : ">"}
          </span>
          {line.line}
        </div>
      ))}
    </div>
  );
}

export function LiveLogPanel({ siteUuid }: LiveLogPanelProps) {
  const { events, connected, error, clearEvents } = useSiteEventsContext();
  const liveRuns = useMemo(() => deriveRunGroups(events), [events]);

  // When there are no live events (e.g. after a refresh), load the last build
  // artifact so the previous run log is still visible.
  const { data: buildArtifact } = useQuery({
    queryKey: ["pipeline-artifact", siteUuid, "build"],
    queryFn: () => api.getPipelineArtifact(siteUuid, "build"),
    enabled: liveRuns.length === 0,
  });

  const runs = useMemo(() => {
    if (liveRuns.length > 0) return liveRuns;
    const payload = buildArtifact?.payload as
      | { rawLines?: LogLine[]; builtPages?: string[] }
      | undefined;
    if (!payload?.rawLines || payload.rawLines.length === 0) return liveRuns;
    const firstAt = payload.rawLines[0]?.at;
    const lastAt = payload.rawLines[payload.rawLines.length - 1]?.at;
    const artifactRun: RunGroup = {
      key: "artifact-build",
      jobId: null,
      startedAt: firstAt ?? buildArtifact?.createdAt ?? null,
      completedAt: lastAt ?? buildArtifact?.createdAt ?? null,
      failedAt: null,
      state: "completed",
      currentStage: "build",
      currentMessage: "Loaded from last build artifact",
      stages: [],
      lines: payload.rawLines,
      error: null,
    };
    return [artifactRun];
  }, [liveRuns, buildArtifact]);

  const activeCount = runs.filter((r) => r.state === "running").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-3">
          <CardTitle>Pipeline runs</CardTitle>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {activeCount} active
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error ? (
            <Badge variant="destructive">Disconnected</Badge>
          ) : connected ? (
            <Badge variant="default">Live</Badge>
          ) : (
            <Badge variant="outline">Connecting…</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={clearEvents}>
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-2 text-xs text-destructive">{error.message}</div>
        )}
        {runs.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No pipeline runs yet. Start a run to see live logs here.
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <details
                key={run.key}
                className="group rounded border [&[open]]:bg-muted/30"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 p-3 hover:bg-muted/50">
                  <span className="text-muted-foreground transition-transform group-open:rotate-90">
                    ▶
                  </span>
                  <RunSummary group={run} />
                </summary>
                <div className="border-t">
                  {run.error && (
                    <div className="px-3 py-2 text-xs text-destructive">
                      {run.error}
                    </div>
                  )}
                  <RunLog lines={run.lines} />
                </div>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
