import { useRef, useEffect } from "react";
import { Bot, User, Sparkles } from "lucide-react";
import type { BuildMessage } from "@/lib/build-messages";

interface BuildChatProps {
  messages: BuildMessage[];
  isLoading: boolean;
}

function MessageAvatar({ role }: { role: BuildMessage["role"] }) {
  if (role === "user") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="h-4 w-4 text-muted-foreground" />
      </div>
    );
  }
  if (role === "system") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Bot className="h-4 w-4" />
    </div>
  );
}

export function BuildChat({ messages, isLoading }: BuildChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  return (
    <div className="flex h-full flex-col bg-card"
      aria-live="polite"
      aria-atomic="false"
    >
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Build Assistant</h2>
        <p className="text-xs text-muted-foreground">
          Ask me to edit pages, approve progress, or publish when ready.
        </p>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 space-y-5 overflow-auto p-4"
      >
        {messages.map((message) => (
          <div key={message.id} className="flex gap-3">
            <MessageAvatar role={message.role} />
            <div className="min-w-0 flex-1 pt-1">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {message.content}
              </p>
              {message.actionLabel && (
                <span className="mt-1.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {message.enqueued && (
                    <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-green-500" />
                  )}
                  {message.actionLabel}
                  {message.enqueued && " queued"}
                </span>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            >
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-1.5 pt-2">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.3s]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
