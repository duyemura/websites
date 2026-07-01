import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BuildCommandInputProps {
  onSubmit: (message: string) => void;
  isLoading: boolean;
}

export function BuildCommandInput({
  onSubmit,
  isLoading,
}: BuildCommandInputProps) {
  const [message, setMessage] = useState("");

  const handleSubmit = () => {
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed);
    setMessage("");
  };

  return (
    <div className="border-t bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Input
          placeholder="Type your message..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={isLoading}
          className="flex-1"
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={isLoading || !message.trim()}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Try "edit the homepage", "approve and continue", "publish the site", or
        "what can you do?"
      </p>
    </div>
  );
}
