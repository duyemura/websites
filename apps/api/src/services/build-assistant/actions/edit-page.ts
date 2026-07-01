import type { BuildAssistantAction, AssistantContext, ActionResult } from "../types";
import crypto from "node:crypto";

export class EditPageAction implements BuildAssistantAction {
  name = "edit_page";

  canHandle(message: string): boolean {
    const text = message.toLowerCase();
    const keywords = ["edit", "change", "update", "hero", "refresh homepage", "headline"];
    return keywords.some((k) => text.includes(k.toLowerCase()));
  }

  async execute(message: string, ctx: AssistantContext): Promise<ActionResult> {
    const { db, queues, workspaceUuid, siteUuid } = ctx;

    const latestJob = await db
      .selectFrom("aiJobs")
      .select("uuid")
      .where("siteUuid", "=", siteUuid)
      .orderBy("createdAt", "desc")
      .executeTakeFirst();

    if (!latestJob) {
      return {
        reply: "I need a build job to edit against. Start a site build first.",
        action: this.name,
        enqueued: false,
        userMessage: message,
      };
    }

    const attemptId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    await queues.generatePage.queue.add("generate_page", {
      workspaceUuid,
      siteUuid,
      pageSlug: "index",
      aiJobUuid: latestJob.uuid,
      attemptId,
    });

    return {
      reply: "I’ll rebuild the homepage with your changes in mind.",
      action: this.name,
      enqueued: true,
      userMessage: message,
      messages: [
        { role: "user", content: message },
        { role: "assistant", content: "I'll rebuild the homepage with your changes in mind." },
      ],
    };
  }
}
