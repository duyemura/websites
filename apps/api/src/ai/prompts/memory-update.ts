import fs from "node:fs";
import path from "node:path";
import type { WorkspaceMemory, SiteMemory } from "@milo/shared-types";

const DEFAULT_TEMPLATE_PATH = path.resolve(__dirname, "./templates/memory-update.md");

let cachedDefaultTemplate: string | null = null;

export function loadMemoryUpdateTemplate(): string {
  if (cachedDefaultTemplate) return cachedDefaultTemplate;
  cachedDefaultTemplate = fs.readFileSync(DEFAULT_TEMPLATE_PATH, "utf8");
  return cachedDefaultTemplate;
}

export interface MemoryUpdateInput {
  existingWorkspaceMemory: WorkspaceMemory;
  existingSiteMemory: SiteMemory;
  whatHappened: string;
  userIntent?: string;
  decisionsLocked?: string[];
  blockers?: string[];
  followUps?: string[];
  placeholders?: string[];
  siteUuid?: string;
  siteUrl?: string;
}

export function buildMemoryUpdatePrompt(input: MemoryUpdateInput, template?: string): string {
  const system = template ?? loadMemoryUpdateTemplate();
  const today = new Date().toISOString().slice(0, 10);
  const extras = [
    input.userIntent ? `User's stated intent/goal:\n${input.userIntent}` : "",
    input.decisionsLocked?.length ? `Decisions to lock:\n${input.decisionsLocked.map((d) => `- ${d}`).join("\n")}` : "",
    input.blockers?.length ? `New or unresolved blockers:\n${input.blockers.map((b) => `- ${b}`).join("\n")}` : "",
    input.followUps?.length ? `Follow-up opportunities to backlog:\n${input.followUps.map((f) => `- ${f}`).join("\n")}` : "",
    input.placeholders?.length
      ? `Known placeholders or manual reconnections needed:\n${input.placeholders.map((p) => `- ${p}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return `${system}

---

Today: ${today}

Existing workspace memory:
${JSON.stringify(input.existingWorkspaceMemory, null, 2)}

Existing site memory:
${JSON.stringify(input.existingSiteMemory, null, 2)}

What happened in this interaction:
${input.whatHappened}

${extras}

Update the workspace and site memory JSON objects. Add dated bullets where appropriate. Only include fields that changed or should be added. Return compact, valid JSON.`;
}
