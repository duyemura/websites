import type { BuildAssistantAction, AssistantContext, ActionResult } from "../types";
import { approvePage } from "../../site-generation-orchestrator";

export class ApprovePageAction implements BuildAssistantAction {
  name = "approve_page";

  canHandle(message: string): boolean {
    const text = message.toLowerCase();
    const keywords = ["approve", "continue", "remaining pages", "build rest", "build the rest"];
    return keywords.some((k) => text.includes(k.toLowerCase()));
  }

  async execute(message: string, ctx: AssistantContext): Promise<ActionResult> {
    const { db, queues, workspaceUuid, siteUuid, userUuid } = ctx;

    try {
      const result = await approvePage({
        db,
        queues,
        workspaceUuid,
        siteUuid,
        pageSlug: "index",
        userUuid,
      });

      const remaining = result.remainingPagesEnqueued;
      return {
        reply:
          remaining.length > 0
            ? `Homepage approved. I’ve queued ${remaining.length} remaining page${remaining.length === 1 ? "" : "s"}: ${remaining.join(", ")}.`
            : "Homepage approved. There are no remaining pages to build.",
        action: this.name,
        enqueued: remaining.length > 0,
        userMessage: message,
        messages: [
          { role: "user", content: message },
          { role: "assistant", content: `Homepage approved. ${remaining.length > 0 ? `Queued ${remaining.join(", ")}.` : "No remaining pages."}` },
        ],
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Approval failed";
      return {
        reply: `I can't approve the homepage right now: ${errorMessage}`,
        action: this.name,
        enqueued: false,
        userMessage: message,
      };
    }
  }
}
