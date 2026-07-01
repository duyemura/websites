import { ExternalLink, Loader2, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BuildPreviewProps {
  previewUrl: string | null | undefined;
  siteName: string;
  isBuilding: boolean;
}

export function BuildPreview({
  previewUrl,
  siteName,
  isBuilding,
}: BuildPreviewProps) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b bg-card px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{siteName}</h2>
            <p className="text-xs text-muted-foreground truncate">
              {isBuilding ? "Cloning website..." : previewUrl ? "Live preview" : "Preview will appear here"}
            </p>
          </div>
        </div>
        {previewUrl && (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Open
            </a>
          </Button>
        )}
      </div>
      <div className="relative flex-1 overflow-hidden p-4">
        {previewUrl ? (
          <iframe
            src={previewUrl}
            title={`Preview of ${siteName}`}
            className="h-full w-full rounded-lg border bg-background shadow-sm"
            sandbox="allow-scripts allow-same-origin"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center rounded-lg border bg-card p-8 text-center">
            <Loader2 className="mb-4 h-10 w-10 animate-spin text-muted-foreground" />
            <p className="text-sm font-medium">
              {isBuilding ? "Cloning your website..." : "Waiting for preview"}
            </p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              {isBuilding
                ? "This usually takes a minute. The preview will appear automatically once the first page is ready."
                : "Start a build or wait for the next deployment to finish."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
