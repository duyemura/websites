import { useMemo, useState, useCallback, useEffect } from "react";
import { useParams, useSearchParams, Link } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BuildChat } from "@/components/site-build/BuildChat";
import { BuildPreview } from "@/components/site-build/BuildPreview";
import { BuildCommandInput } from "@/components/site-build/BuildCommandInput";
import { api, type BuildCommandResponse } from "@/lib/api";
import { deriveMessages } from "@/lib/build-messages";

const REFRESH_INTERVAL_MS = 4000;

export function SiteBuild() {
  const { siteUuid } = useParams<{ siteUuid: string }>();
  const [searchParams] = useSearchParams();
  const jobUuid = searchParams.get("job");
  const queryClient = useQueryClient();
  const [commandResponses, setCommandResponses] = useState<BuildCommandResponse[]>([]);
  const [commandError, setCommandError] = useState<string | null>(null);

  const {
    data: build,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["sites", siteUuid, "build-status"],
    queryFn: () => api.getBuildStatus(siteUuid!),
    enabled: !!siteUuid,
    refetchInterval: (query) => {
      const status = query.state.data?.aiJob?.status;
      const shouldPoll = status === "pending" || status === "running";
      return shouldPoll ? REFRESH_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: false,
  });

  const sendCommand = useMutation({
    mutationFn: (message: string) => api.sendBuildCommand(siteUuid!, message),
    onMutate: () => {
      setCommandError(null);
    },
    onSuccess: (response) => {
      setCommandResponses((prev) => {
        const next = [...prev, response];
        return next.slice(-50);
      });
      queryClient.invalidateQueries({ queryKey: ["sites", siteUuid, "build-status"] });
    },
    onError: (err) => {
      setCommandError(err.message.replace(/^\d+:\s*/, ""));
    },
  });

  const handleCommand = useCallback(
    (message: string) => {
      if (!siteUuid) return;
      sendCommand.mutate(message);
    },
    [siteUuid, sendCommand],
  );

  const messages = useMemo(
    () => deriveMessages(build, commandResponses),
    [build, commandResponses],
  );

  const isBuilding = build?.aiJob?.status === "running" || build?.aiJob?.status === "pending";

  useEffect(() => {
    document.title = build?.site.name
      ? `${build.site.name} — Build`
      : "Build Site";
  }, [build?.site.name]);

  if (!siteUuid) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Site not found.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b px-6 py-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to sites
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">Build Site</h1>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error || !build) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-3 border-b px-6 py-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to sites
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">Build Site</h1>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">
            {error ? error.message : "Unable to load build status."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to sites
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">{build.site.name}</h1>
            {jobUuid && (
              <p className="text-xs text-muted-foreground">Job {jobUuid.slice(0, 8)}…</p>
            )}
          </div>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-[45%] min-w-0 flex-col border-r">
          <BuildChat messages={messages} isLoading={sendCommand.isPending} />
          {commandError && (
            <p className="border-t px-4 py-2 text-sm text-destructive">{commandError}</p>
          )}
          <BuildCommandInput
            onSubmit={handleCommand}
            isLoading={sendCommand.isPending}
          />
        </div>
        <div className="flex-1 min-w-0">
          <BuildPreview
            previewUrl={build.deployment?.previewUrl}
            siteName={build.site.name}
            isBuilding={isBuilding}
          />
        </div>
      </div>
    </div>
  );
}
