import type { BuildAssistantAction, ActionResult } from "../types";

export class HelpAction implements BuildAssistantAction {
  name = "help";

  canHandle(): boolean {
    return true;
  }

  async execute(message: string): Promise<ActionResult> {
    return {
      reply:
        "Here's what I can help with today:\n" +
        "- Edit the homepage (say \"edit the homepage\" or \"change the hero\")\n" +
        "- Approve the homepage and build remaining pages\n" +
        "- Publish the site\n" +
        "- Open the preview\n" +
        "What would you like to do?",
      action: this.name,
      enqueued: false,
      userMessage: message,
      messages: [
        { role: "user", content: message },
        { role: "assistant", content: "Here's what I can help with today: edit the homepage, approve and continue, publish, or open the preview." },
      ],
    };
  }
}
