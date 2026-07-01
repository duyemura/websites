import type { BuildStatus, BuildCommandResponse } from "./api";

export type BuildMessageRole = "assistant" | "user" | "system";

export interface BuildMessage {
  id: string;
  role: BuildMessageRole;
  content: string;
  createdAt: Date;
  action?: string;
  actionLabel?: string;
  enqueued?: boolean;
}

function describeJobStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "running":
      return "Building";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return status;
  }
}

function actionSlugToLabel(slug: string): string {
  switch (slug) {
    case "edit_page":
      return "Edit page";
    case "approve_page":
      return "Approve page";
    case "publish_page":
      return "Publish page";
    case "preview_info":
      return "Preview info";
    case "help":
      return "Help";
    default:
      return slug;
  }
}

export function deriveMessages(
  build: BuildStatus | undefined,
  commandResponses: BuildCommandResponse[],
): BuildMessage[] {
  const messages: BuildMessage[] = [];

  if (!build) return messages;

  messages.push({
    id: `welcome-${build.site.uuid}`,
    role: "assistant",
    content: `Starting to replicate ${build.site.name}. I'll scrape the source site, build each page, and show you previews as I go.`,
    createdAt: new Date(build.site.createdAt),
  });

  if (build.aiJob) {
    const state =
      typeof build.aiJob.state === "object" && build.aiJob.state !== null
        ? (build.aiJob.state as { phase?: string; currentSlug?: string })
        : {};
    const phase = state.phase ?? "build";
    const slug = state.currentSlug;
    const statusLabel = describeJobStatus(build.aiJob.status);
    let content = `${statusLabel}: ${phase}`;
    if (slug) {
      content += ` (${slug})`;
    }
    messages.push({
      id: `job-${build.aiJob.uuid}`,
      role: "system",
      content,
      createdAt: new Date(build.aiJob.updatedAt),
    });
  }

  const sortedActivity = [...build.aiActivity].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  for (const activity of sortedActivity) {
    if (!activity.summary) continue;
    messages.push({
      id: `activity-${activity.uuid}`,
      role: "system",
      content: activity.summary,
      createdAt: new Date(activity.createdAt),
      action: activity.actionType,
      actionLabel: activity.actionType
        ? actionSlugToLabel(activity.actionType)
        : undefined,
    });
  }

  for (let i = 0; i < commandResponses.length; i++) {
    const response = commandResponses[i];

    if (response.userMessage) {
      messages.push({
        id: `cmd-${i}-user`,
        role: "user",
        content: response.userMessage,
        createdAt: new Date(),
      });
    }

    const responseMessages = response.messages ?? [
      { role: "assistant" as const, content: response.reply },
    ];
    for (const msg of responseMessages) {
      if (msg.role === "user" && response.userMessage) continue;
      messages.push({
        id: `cmd-${i}-${msg.role}`,
        role: msg.role,
        content: msg.content,
        createdAt: new Date(),
        action: response.action ?? undefined,
        actionLabel: response.action
          ? actionSlugToLabel(response.action)
          : undefined,
        enqueued: response.enqueued,
      });
    }
  }

  return messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
