import { describe, test, expect } from "vitest";
import { buildMemoryUpdatePrompt, loadMemoryUpdateTemplate } from "../memory-update";
import type { WorkspaceMemory, SiteMemory } from "@ploy-gyms/shared-types";

const workspaceMemory: WorkspaceMemory = {
  businessSnapshot: "Beta Gym — fitness / gym | Stronger together.",
  positioning: "Personal training for busy parents who need efficient, coached workouts.",
  stakeholderName: "Chris McConachie",
  stakeholderRole: "Co-founder",
  stakeholderEmail: "chris@pushpress.com",
  currentGoal: "Convert visitors into free-trial signups",
  differentiators: [],
  businessPriorities: [],
  keyConstraints: [],
  targetMembers: [],
  antiTargetMembers: [],
  lockedDecisions: ["Keep dark mode globally"],
  knownBlockers: [],
  followUpBacklog: [],
  referenceDocKeys: ["brand-guidelines", "business-info"],
};

const siteMemory: SiteMemory = {
  sitePurpose: "Primary conversion site for Beta Gym",
  sourceUrl: "https://betagym.com",
  replicationStatus: "Scanned from https://betagym.com. Full-page screenshot captured.",
  recentEdits: [],
  qaIssues: [],
  publishState: "draft",
  followUpBacklog: [],
  knownPlaceholders: [],
};

describe("memory-update prompt", () => {
  test("loads the default markdown template", () => {
    const template = loadMemoryUpdateTemplate();
    expect(template).toContain("# Memory Update Instructions");
    expect(template).toContain("workspace-memory");
    expect(template).toContain("site-memory");
  });

  test("builds a prompt using the loaded template", () => {
    const prompt = buildMemoryUpdatePrompt({
      existingWorkspaceMemory: workspaceMemory,
      existingSiteMemory: siteMemory,
      whatHappened: "User changed the hero headline to 'Awesome for Absolutely Everyone.'",
      decisionsLocked: ["Hero headline: 'Awesome for Absolutely Everyone.'"],
    });
    expect(prompt).toContain("# Memory Update Instructions");
    expect(prompt).toContain("Beta Gym");
    expect(prompt).toContain("User changed the hero headline");
    expect(prompt).toContain("Decisions to lock");
    expect(prompt).toContain("Return compact, valid JSON");
  });

  test("accepts an alternate template string", () => {
    const custom = "## Custom instruction\nOnly update the site memory.";
    const prompt = buildMemoryUpdatePrompt(
      {
        existingWorkspaceMemory: workspaceMemory,
        existingSiteMemory: siteMemory,
        whatHappened: "Test event",
      },
      custom,
    );
    expect(prompt).toContain("## Custom instruction");
    expect(prompt).not.toContain("# Memory Update Instructions");
  });
});
