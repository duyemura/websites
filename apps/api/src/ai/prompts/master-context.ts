import type { Doc } from "@ploy-gyms/shared-types";

export interface AssembledContext {
  prompt: string;
  includedKeys: string[];
  warnings: string[];
}

export interface ContextAssemblyOptions {
  maxChars?: number;
  currentSiteUuid?: string;
  currentGoal?: string;
  includeKeys?: string[];
  excludeKeys?: string[];
}

const DEFAULT_PRIORITY = [
  "workspace-memory",
  "site-memory",
  "brand-guidelines",
  "business-info",
  "voice-copy",
  "site-structure",
  "offerings",
  "locations",
  "team-bios",
  "testimonials",
  "faqs",
];

function truncateToChars(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(" "));
  return (lastBreak > chars * 0.8 ? cut.slice(0, lastBreak) : cut) + "\n\n[Content truncated for context window.]";
}

export function assembleMasterContext(docs: Doc[], options: ContextAssemblyOptions = {}): AssembledContext {
  const { maxChars = 12000, includeKeys, excludeKeys = [], currentSiteUuid, currentGoal } = options;
  const warnings: string[] = [];

  let orderedKeys = [...DEFAULT_PRIORITY];
  if (includeKeys && includeKeys.length > 0) {
    orderedKeys = includeKeys;
  }
  orderedKeys = orderedKeys.filter((k) => !excludeKeys.includes(k));

  const byKey = new Map(docs.map((d) => [d.key, d]));
  const includedKeys: string[] = [];
  const sections: string[] = [];

  // Workspace memory is always first and used as the lens.
  const workspaceMemory = byKey.get("workspace-memory");
  if (workspaceMemory?.content) {
    sections.push(`## Workspace context\n\n${workspaceMemory.content}`);
    includedKeys.push("workspace-memory");
  } else {
    warnings.push("No workspace-memory doc found; generation may lack business context.");
  }

  // Site memory is next if we know which site we're working on.
  // Future: when docs gain a siteUuid column, prefer the active site memory here.
  const siteMemory = byKey.get("site-memory");
  if (siteMemory?.content) {
    if (currentSiteUuid) {
      sections.push(`## Active site context (${currentSiteUuid})\n\n${siteMemory.content}`);
    } else {
      sections.push(`## Active site context\n\n${siteMemory.content}`);
    }
    includedKeys.push("site-memory");
  }

  // Goal override if provided.
  if (currentGoal) {
    sections.push(`## Current focus\n\n- ${currentGoal}`);
  }

  for (const key of orderedKeys) {
    if (key === "workspace-memory" || key === "site-memory") continue;
    const doc = byKey.get(key);
    if (!doc?.content) continue;
    sections.push(`## ${doc.title} (${doc.key})\n\n${doc.content}`);
    includedKeys.push(key);
  }

  const fullContext = sections.join("\n\n---\n\n");
  const prompt = `You are the AI website builder for a gym/studio workspace. Use the following layered context to make decisions. Recent memory and active-site context override older docs when they conflict. Keep responses aligned with the workspace's current goal and brand. Avoid duplicating content that already exists; reference docs by key when appropriate.\n\n${truncateToChars(fullContext, maxChars)}`;

  if (fullContext.length > maxChars) {
    warnings.push(`Assembled context was ${fullContext.length} chars; truncated to ${maxChars}.`);
  }

  return { prompt, includedKeys, warnings };
}
