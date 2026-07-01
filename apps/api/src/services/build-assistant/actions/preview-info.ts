import type { BuildAssistantAction, AssistantContext, ActionResult } from "../types";

export class PreviewInfoAction implements BuildAssistantAction {
  name = "preview_info";

  canHandle(message: string): boolean {
    const text = message.toLowerCase();
    const keywords = ["preview", "open site", "view site"];
    return keywords.some((k) => text.includes(k.toLowerCase()));
  }

  async execute(message: string, ctx: AssistantContext): Promise<ActionResult> {
    const { deployment } = ctx;

    if (deployment?.previewUrl) {
      return {
        reply: `Here’s the latest preview: ${deployment.previewUrl}`,
        action: this.name,
        enqueued: false,
        messages: [
          { role: "user", content: message },
          { role: "assistant", content: `Here’s the latest preview: ${deployment.previewUrl}` },
        ],
      };
    }

    return {
      reply: "No preview is ready yet. Wait for the homepage build to finish.",
      action: this.name,
      enqueued: false,
    };
  }
}
