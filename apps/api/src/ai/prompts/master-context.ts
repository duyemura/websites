import type { Doc } from "@ploy-gyms/shared-types";

export type ContextJob =
  | "website-generation"
  | "seo-report"
  | "form-activity-report"
  | "brand-review"
  | "custom";

export interface AssembledContext {
  prompt: string;
  includedKeys: string[];
  warnings: string[];
}

export interface ContextAssemblyOptions {
  job?: ContextJob;
  maxChars?: number;
  currentSiteUuid?: string;
  currentGoal?: string;
  includeKeys?: string[];
  excludeKeys?: string[];
}

const JOB_PRESETS: Record<
  ContextJob,
  { priority: string[]; promptRole: string }
> = {
  "website-generation": {
    priority: [
      "workspace-memory",
      "site-memory",
      "brand-guidelines",
      "business-info",
      "site-structure",
      "team-bios",
      "testimonials",
      "faqs",
    ],
    promptRole: "You are the AI website builder for a gym/studio workspace.",
  },
  "seo-report": {
    priority: [
      "workspace-memory",
      "site-memory",
      "business-info",
      "site-structure",
    ],
    promptRole: "You are an SEO analyst for a gym/studio workspace.",
  },
  "form-activity-report": {
    priority: ["workspace-memory", "site-memory", "business-info"],
    promptRole:
      "You are a form and conversion analyst for a gym/studio workspace.",
  },
  "brand-review": {
    priority: ["workspace-memory", "site-memory", "brand-guidelines"],
    promptRole: "You are a brand reviewer for a gym/studio workspace.",
  },
  custom: {
    priority: [],
    promptRole: "You are an AI assistant for a gym/studio workspace.",
  },
};

function truncateToChars(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return (
    (lastBreak > chars * 0.8 ? cut.slice(0, lastBreak) : cut) +
    "\n\n[Content truncated for context window.]"
  );
}

export function assembleMasterContext(
  docs: Doc[],
  options: ContextAssemblyOptions = {},
): AssembledContext {
  const {
    job,
    maxChars = 12000,
    includeKeys,
    excludeKeys = [],
    currentSiteUuid,
    currentGoal,
  } = options;
  const warnings: string[] = [];

  let orderedKeys: string[] = [];
  if (includeKeys && includeKeys.length > 0) {
    orderedKeys = includeKeys;
  } else if (job && job !== "custom") {
    orderedKeys = [...JOB_PRESETS[job].priority];
  }

  if (orderedKeys.length === 0) {
    warnings.push(
      "No job or includeKeys provided; context is empty. Pass a job (e.g. 'website-generation') or explicit includeKeys.",
    );
    return {
      prompt: `${
        job ? JOB_PRESETS[job].promptRole : JOB_PRESETS.custom.promptRole
      }\n\nNo context was included.`,
      includedKeys: [],
      warnings,
    };
  }

  orderedKeys = orderedKeys.filter((k) => !excludeKeys.includes(k));

  const byKey = new Map(docs.map((d) => [d.key, d]));
  const includedKeys: string[] = [];
  const sections: string[] = [];

  const workspaceMemory = byKey.get("workspace-memory");
  if (workspaceMemory?.content) {
    sections.push(`## Workspace context\n\n${workspaceMemory.content}`);
    includedKeys.push("workspace-memory");
  } else {
    warnings.push(
      "No workspace-memory doc found; generation may lack business context.",
    );
  }

  const siteMemory = byKey.get("site-memory");
  if (siteMemory?.content) {
    if (currentSiteUuid) {
      sections.push(
        `## Active site context (${currentSiteUuid})\n\n${siteMemory.content}`,
      );
    } else {
      sections.push(`## Active site context\n\n${siteMemory.content}`);
    }
    includedKeys.push("site-memory");
  } else {
    warnings.push("No site-memory doc found; generation may lack active-site context.");
  }

  if (currentGoal) {
    sections.push(`## Current focus\n\n- ${currentGoal}`);
  }

  for (const key of orderedKeys) {
    if (key === "workspace-memory" || key === "site-memory") continue;
    const doc = byKey.get(key);
    if (!doc?.content) {
      warnings.push(`Doc '${key}' was requested but not found or empty.`);
      continue;
    }
    sections.push(`## ${doc.title} (${doc.key})\n\n${doc.content}`);
    includedKeys.push(key);
  }

  const fullContext = sections.join("\n\n---\n\n");
  const promptRole =
    job && job !== "custom"
      ? JOB_PRESETS[job].promptRole
      : JOB_PRESETS.custom.promptRole;
  const prompt = `${promptRole} Use the following layered context to make decisions. Recent memory and active-site context override older docs when they conflict. Keep responses aligned with the workspace's current goal and brand. Avoid duplicating content that already exists; reference docs by key when appropriate.\n\n${truncateToChars(fullContext, maxChars)}`;

  if (fullContext.length > maxChars) {
    warnings.push(
      `Assembled context was ${fullContext.length} chars; truncated to ${maxChars}.`,
    );
  }

  return { prompt, includedKeys, warnings };
}
