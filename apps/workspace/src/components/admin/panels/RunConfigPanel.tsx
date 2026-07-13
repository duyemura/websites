import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type PipelineRunBody } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  PipelineRunFields,
  type PipelineRunFieldValues,
} from "./PipelineRunFields";
import { LiveLogPanel } from "./LiveLogPanel";

interface RunConfigPanelProps {
  siteUuid: string;
}

export function RunConfigPanel({ siteUuid }: RunConfigPanelProps) {
  const queryClient = useQueryClient();
  const { data: site, isLoading: siteLoading } = useQuery({
    queryKey: ["site", siteUuid],
    queryFn: () => api.getSite(siteUuid),
  });
  const { data: options, isLoading: optionsLoading } = useQuery({
    queryKey: ["pipeline-options", siteUuid],
    queryFn: () => api.getPipelineOptions(siteUuid),
  });

  const [runType, setRunType] = useState<"full" | "stage">("full");
  const [selectedStage, setSelectedStage] = useState<string>("extract");
  const [scope, setScope] = useState<"homepage" | "full" | "custom">("homepage");
  const [values, setValues] = useState<PipelineRunFieldValues>({});
  const [runTag, setRunTag] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobQueue, setJobQueue] = useState<string | null>(null);

  useEffect(() => {
    if (site && options) {
      setValues((prev) => ({
        ...prev,
        url: site.sourceUrl ?? "",
        tier: site.tier ?? "free",
        mode: site.mode ?? "replication",
      }));
    }
  }, [site, options]);

  const runMutation = useMutation({
    mutationFn: async (body: PipelineRunBody) => {
      if (runType === "full") {
        return api.runPipeline(siteUuid, body);
      }
      return api.runPipelineStage(siteUuid, selectedStage, body);
    },
    onSuccess: (result) => {
      setJobId(result.jobId);
      setJobQueue(result.queue ?? null);
      void queryClient.invalidateQueries({ queryKey: ["pipeline-status", siteUuid] });
    },
  });

  const { data: jobStatus } = useQuery({
    queryKey: ["job-status", jobId, jobQueue],
    queryFn: () => (jobId ? api.getJobStatus(jobId, jobQueue ?? undefined) : Promise.resolve(null)),
    refetchInterval: jobId ? 3000 : false,
    enabled: Boolean(jobId),
  });

  const currentScope = useMemo(() => {
    const pages = values.pages;
    if (!pages || pages.length === 0) return "full";
    if (pages.length === 1 && pages[0] === "/") return "homepage";
    return "custom";
  }, [values.pages]);

  useEffect(() => {
    setScope(currentScope);
  }, [currentScope]);

  function buildBody(): PipelineRunBody {
    const body: PipelineRunBody = {
      url: String(values.url ?? ""),
    };
    if (values.pages) {
      const pages = values.pages.filter(Boolean);
      if (pages.length > 0) body.pages = pages;
    }
    if (values.mode) body.mode = values.mode as PipelineRunBody["mode"];
    if (values.tier) body.tier = values.tier as PipelineRunBody["tier"];
    if (values.contentSiteUuid) body.contentSiteUuid = String(values.contentSiteUuid);
    if (values.designSiteUuid) body.designSiteUuid = String(values.designSiteUuid);
    return body;
  }

  function handleScopeChange(next: "homepage" | "full" | "custom") {
    setScope(next);
    if (next === "homepage") {
      setValues((prev) => ({ ...prev, pages: ["/"] }));
    } else if (next === "full") {
      const nextValues = { ...values };
      delete nextValues.pages;
      setValues(nextValues);
    } else {
      setValues((prev) => ({ ...prev, pages: prev.pages?.length ? prev.pages : [""] }));
    }
  }

  if (siteLoading || optionsLoading) return <Skeleton className="h-96 w-full" />;
  if (!options) return <div className="text-destructive">Failed to load pipeline options.</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configure pipeline run</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineRunFields
            options={options}
            runType={runType}
            selectedStage={selectedStage}
            scope={scope}
            runTag={runTag}
            values={values}
            isPending={runMutation.isPending}
            error={runMutation.error}
            onRunTypeChange={setRunType}
            onSelectedStageChange={setSelectedStage}
            onScopeChange={handleScopeChange}
            onValuesChange={setValues}
            onRunTagChange={setRunTag}
            onSubmit={() => runMutation.mutate(buildBody())}
          />
        </CardContent>
      </Card>

      {jobId && (
        <Card>
          <CardHeader>
            <CardTitle>Job status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="font-mono">{jobId}</div>
            {jobStatus ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">State:</span>
                  <Badge
                    variant={
                      jobStatus.state === "completed"
                        ? "default"
                        : jobStatus.state === "failed"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {jobStatus.state ?? "unknown"}
                  </Badge>
                </div>
                {jobStatus.queue && (
                  <div>
                    <span className="text-muted-foreground">Queue:</span> {jobStatus.queue}
                  </div>
                )}
                {jobStatus.failedReason && (
                  <div className="text-destructive">{jobStatus.failedReason}</div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground">Loading status…</div>
            )}
          </CardContent>
        </Card>
      )}

      <LiveLogPanel siteUuid={siteUuid} />
    </div>
  );
}
