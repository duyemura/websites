import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type PipelineRunBody } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  PipelineRunFields,
  type PipelineRunFieldValues,
} from "./PipelineRunFields";

interface NewSitePanelProps {
  onCreated?: (siteUuid: string, initialTab?: "run") => void;
}

export function NewSitePanel({ onCreated }: NewSitePanelProps) {
  const queryClient = useQueryClient();
  const { data: options, isLoading } = useQuery({
    queryKey: ["pipeline-options", "global"],
    queryFn: () => api.getGlobalPipelineOptions(),
  });

  const [runType, setRunType] = useState<"full" | "stage">("full");
  const [selectedStage, setSelectedStage] = useState<string>("extract");
  const [scope, setScope] = useState<"homepage" | "full" | "custom">("homepage");
  const [values, setValues] = useState<PipelineRunFieldValues>({});
  const [runTag, setRunTag] = useState<string>("");
  const [createdSiteUuid, setCreatedSiteUuid] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobQueue, setJobQueue] = useState<string | null>(null);

  useEffect(() => {
    if (options) {
      setValues((prev) => ({
        ...prev,
        url: prev.url ?? "",
        tier: prev.tier ?? "free",
        mode: prev.mode ?? "replication",
        pages: ["/"],
      }));
    }
  }, [options]);

  const createAndRunMutation = useMutation({
    mutationFn: async (body: PipelineRunBody) => {
      const site = await api.createSite({
        sourceUrl: body.url,
        mode: body.mode,
        tier: body.tier,
      });
      const run = await api.runPipeline(site.uuid, body);
      return { site, jobId: run.jobId, queue: run.queue };
    },
    onSuccess: ({ site, jobId: newJobId, queue }) => {
      setCreatedSiteUuid(site.uuid);
      setJobId(newJobId);
      setJobQueue(queue ?? null);
      void queryClient.invalidateQueries({ queryKey: ["sites"] });
      onCreated?.(site.uuid, "run");
    },
  });

  const { data: jobStatus } = useQuery({
    queryKey: ["job-status", jobId, jobQueue],
    queryFn: () => (jobId ? api.getJobStatus(jobId, jobQueue ?? undefined) : Promise.resolve(null)),
    refetchInterval: jobId ? 3000 : false,
    enabled: Boolean(jobId),
  });

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

  function handleSubmit() {
    if (runType === "stage") {
      throw new Error("New sites must start with a full pipeline run");
    }
    createAndRunMutation.mutate(buildBody());
  }

  const currentScope = useMemo(() => {
    const pages = values.pages;
    if (!pages || pages.length === 0) return "full";
    if (pages.length === 1 && pages[0] === "/") return "homepage";
    return "custom";
  }, [values.pages]);

  useEffect(() => {
    setScope(currentScope);
  }, [currentScope]);

  if (isLoading || !options) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create site and run pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineRunFields
            options={options}
            runType={runType}
            selectedStage={selectedStage}
            scope={scope}
            runTag={runTag}
            values={values}
            isPending={createAndRunMutation.isPending}
            error={createAndRunMutation.error}
            submitLabel="Create site and run"
            onRunTypeChange={setRunType}
            onSelectedStageChange={setSelectedStage}
            onScopeChange={(next) => {
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
            }}
            onValuesChange={setValues}
            onRunTagChange={setRunTag}
            onSubmit={handleSubmit}
          />
          {runType === "stage" && (
            <p className="pt-2 text-xs text-muted-foreground">
              New sites must start with a full pipeline run.
            </p>
          )}
        </CardContent>
      </Card>

      {createdSiteUuid && (
        <Card>
          <CardHeader>
            <CardTitle>Created site</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">UUID:</span>
              <span className="font-mono">{createdSiteUuid}</span>
            </div>
            <Button size="sm" onClick={() => onCreated?.(createdSiteUuid, "run")}>
              Open site
            </Button>
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}
