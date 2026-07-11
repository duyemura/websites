import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatAssistantPanelProps {
  siteUuid: string;
  onClose?: () => void;
}

const PLACEHOLDER_HISTORY = [
  {
    role: "assistant" as const,
    text: "Hi! I'm the site assistant. I can help you edit content, run builds, and answer questions about this site.",
  },
];

export function ChatAssistantPanel({
  siteUuid: _siteUuid,
  onClose,
}: ChatAssistantPanelProps) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">AI chat</span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {PLACEHOLDER_HISTORY.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[90%] rounded-lg px-3 py-2 text-sm",
              msg.role === "assistant"
                ? "bg-muted"
                : "ml-auto bg-primary text-primary-foreground",
            )}
          >
            {msg.text}
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t p-3">
        <textarea
          rows={5}
          placeholder="Ask the assistant"
          className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
          disabled
        />
        <Button size="sm" disabled className="w-full">
          Send
        </Button>
      </div>
    </div>
  );
}
