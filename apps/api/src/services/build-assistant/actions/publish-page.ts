import type { BuildAssistantAction, AssistantContext, ActionResult } from "../types";

export class PublishPageAction implements BuildAssistantAction {
  name = "publish_page";

  canHandle(message: string): boolean {
    const text = message.toLowerCase();
    const keywords = ["publish", "go live", "deploy"];
    return keywords.some((k) => text.includes(k.toLowerCase()));
  }

  async execute(message: string, ctx: AssistantContext): Promise<ActionResult> {
    const { db, queues, siteUuid } = ctx;

    const deployment = await db
      .selectFrom("deployments")
      .select(["uuid", "status"])
      .where("siteUuid", "=", siteUuid)
      .orderBy("createdAt", "desc")
      .executeTakeFirst();

    if (!deployment) {
      return {
        reply: "There's no deployment to publish yet. Wait for the homepage preview to finish building.",
        action: this.name,
        enqueued: false,
        userMessage: message,
      };
    }

    if (deployment.status !== "success") {
      return {
        reply: "The latest deployment didn't succeed, so I can't publish it yet. Fix the build issues first.",
        action: this.name,
        enqueued: false,
        userMessage: message,
      };
    }

    await queues.sitePublish.queue.add("site_publish", {
      siteUuid,
      deploymentUuid: deployment.uuid,
    });

    return {
      reply: "Publishing the site now. It will be live shortly.",
      action: this.name,
      enqueued: true,
      userMessage: message,
      messages: [
        { role: "user", content: message },
        { role: "assistant", content: "Publishing the site now. It will be live shortly." },
      ],
    };
  }
}
