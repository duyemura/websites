import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ArtifactsPanelProps {
  siteUuid: string;
}

const STAGES = ["extract", "segment", "contract", "docgen", "build", "verify"] as const;

export function ArtifactsPanel({ siteUuid }: ArtifactsPanelProps) {
  const [openStage, setOpenStage] = useState<string | null>("extract");

  return (
    <div className="space-y-3">
      {STAGES.map((stage) => (
        <ArtifactAccordion
          key={stage}
          siteUuid={siteUuid}
          stage={stage}
          isOpen={openStage === stage}
          onToggle={() => setOpenStage(openStage === stage ? null : stage)}
        />
      ))}
    </div>
  );
}

function ArtifactAccordion({
  siteUuid,
  stage,
  isOpen,
  onToggle,
}: {
  siteUuid: string;
  stage: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pipeline-artifact", siteUuid, stage],
    queryFn: () => api.getPipelineArtifact(siteUuid, stage),
    enabled: isOpen,
  });

  return (
    <Card className={cn(isOpen && "border-primary")}>
      <CardHeader className="py-3">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-between text-left"
        >
          <CardTitle className="text-base capitalize">{stage}</CardTitle>
          <span className="text-sm text-muted-foreground">{isOpen ? "Collapse" : "Expand"}</span>
        </button>
      </CardHeader>
      {isOpen && (
        <CardContent className="pt-0">
          {isLoading && <Skeleton className="h-40 w-full" />}
          {error && (
            <div className="text-sm text-destructive">Failed to load: {error.message}</div>
          )}
          {data && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Version {data.version} · {new Date(data.createdAt).toLocaleString()}
              </div>
              <pre className="max-h-[500px] overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(data.payload, null, 2)}
              </pre>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigator.clipboard.writeText(JSON.stringify(data.payload, null, 2))
                }
              >
                Copy JSON
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
