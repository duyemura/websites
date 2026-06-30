import type { WorkspaceMemory, SiteMemory } from "@ploy-gyms/shared-types";
import type { ScrapedWebsiteData } from "./scrape-docs";

export const WORKSPACE_MEMORY_DOC_KEY = "workspace-memory";
export const WORKSPACE_MEMORY_DOC_TITLE = "Workspace memory";
export const SITE_MEMORY_DOC_KEY = "site-memory";
export const SITE_MEMORY_DOC_TITLE = "Site memory";

export function generateWorkspaceMemory(
  data: ScrapedWebsiteData,
  overrides: Partial<WorkspaceMemory> = {},
): WorkspaceMemory {
  const businessSnapshot = [
    data.businessName ?? data.title,
    data.industry ? `— ${data.industry}` : "",
    data.tagline ? `| ${data.tagline}` : "",
    data.locations.length > 0 ? `| ${data.locations.length} location(s)` : "",
    data.offerings.length > 0
      ? `| offers ${data.offerings.map((o: { name?: string }) => o.name).filter(Boolean).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const elevatorPitch = data.description
    ? `${data.businessName ?? data.title} — ${data.description}`
    : (data.tagline
      ? `${data.businessName ?? data.title} — ${data.tagline}`
      : data.title);

  const industry = data.industry;

  const targetMember = data.offerings.length > 0
    ? `People interested in ${data.offerings.map((o) => o.name).filter(Boolean).join(", ").toLowerCase()}`
    : "Prospects researching the gym online";

  const differentiators: string[] = [];
  if (data.offerings.length > 0) {
    differentiators.push(`Offers ${data.offerings.map((o) => o.name).filter(Boolean).join(", ")}`);
  }
  if (data.locations.length > 0) {
    differentiators.push(`Local presence at ${data.locations.length} location(s)`);
  }
  if (data.testimonials.length > 0) {
    differentiators.push("Social proof from member testimonials");
  }
  if (data.team.length > 0) {
    differentiators.push(`Coaches/team highlighted: ${data.team.map((t) => t.name).filter(Boolean).slice(0, 3).join(", ")}`);
  }
  if (differentiators.length === 0) {
    differentiators.push("Unique positioning not yet captured");
  }

  const brandVoice = data.description
    ? `Inferred from source copy: ${data.description.slice(0, 120).replace(/\.$/, "")}`
    : "Tone to be defined by user";

  const firstOffering = data.offerings[0]?.name?.toLowerCase() ?? "";
  const ctaGoal = firstOffering.includes("trial")
    ? "Convert visitors into free-trial signups"
    : firstOffering.includes("intro")
      ? "Book intro sessions with prospects"
      : "Drive membership inquiries";

  const businessPriorities = [ctaGoal];
  if (data.locations.length > 0) businessPriorities.push("Make location and hours easy to find");
  if (data.contact?.phone) businessPriorities.push("Encourage phone contact for prospective members");

  const keyConstraints: string[] = [];
  if (data.offerings.length === 0) keyConstraints.push("No offerings detected; user should confirm classes/services");
  if (data.locations.length === 0) keyConstraints.push("No locations detected; verify address before publishing");

  return {
    businessSnapshot,
    elevatorPitch: overrides.elevatorPitch ?? elevatorPitch,
    industry: overrides.industry ?? industry,
    targetMember: overrides.targetMember ?? targetMember,
    differentiators: overrides.differentiators ?? differentiators,
    brandVoice: overrides.brandVoice ?? brandVoice,
    businessPriorities: overrides.businessPriorities ?? businessPriorities,
    keyConstraints: overrides.keyConstraints ?? keyConstraints,
    stakeholderName: overrides.stakeholderName,
    stakeholderRole: overrides.stakeholderRole,
    stakeholderEmail: overrides.stakeholderEmail,
    stakeholderNotes: overrides.stakeholderNotes,
    currentGoal: overrides.currentGoal ?? ctaGoal,
    brandPositioning: overrides.brandPositioning ?? data.tagline,
    lockedDecisions: overrides.lockedDecisions ?? [],
    knownBlockers: overrides.knownBlockers ?? [],
    followUpBacklog: overrides.followUpBacklog ?? [],
    referenceDocKeys: overrides.referenceDocKeys ?? [
      "brand-guidelines",
      "business-info",
      "site-strategy",
      "blueprint-draft",
    ],
  };
}

export function generateSiteMemory(
  data: ScrapedWebsiteData,
  overrides: Partial<SiteMemory> = {},
): SiteMemory {
  const sitePurpose = data.offerings.length > 0
    ? `Primary conversion site for ${data.businessName ?? data.title}`
    : `Marketing site for ${data.businessName ?? data.title}`;

  const replicationStatus = `Scanned from ${data.url}. ${
    data.screenshotUrls && data.screenshotUrls.length > 0 ? "Full-page screenshot captured." : ""
  }`;

  const qaIssues: string[] = [];
  if (data.images.length === 0) qaIssues.push("No usable images detected; hero/product visuals may need replacement assets.");
  if (data.locations.length === 0) qaIssues.push("No locations section detected.");
  if (data.offerings.length === 0) qaIssues.push("No offerings/pricing section detected.");

  return {
    sitePurpose: overrides.sitePurpose ?? sitePurpose,
    sourceUrl: overrides.sourceUrl ?? data.url,
    replicationStatus: overrides.replicationStatus ?? replicationStatus,
    recentEdits: overrides.recentEdits ?? [],
    qaIssues: overrides.qaIssues ?? qaIssues,
    publishState: overrides.publishState ?? "draft",
    followUpBacklog: overrides.followUpBacklog ?? [],
    knownPlaceholders: overrides.knownPlaceholders ?? [],
  };
}

function renderList(title: string, items: string[]): string {
  if (items.length === 0) return "";
  return `## ${title}\n\n${items.map((i) => `- ${i}`).join("\n")}\n`;
}

export function renderWorkspaceMemory(memory: WorkspaceMemory): string {
  const parts = [
    "# Workspace Memory",
    "",
    "Workspace-specific context to maintain continuity across sessions. AI-maintained; user-editable.",
    "",
    "## About the business",
    "",
    `- **Business snapshot**: ${memory.businessSnapshot}`,
  ];

  if (memory.elevatorPitch) {
    parts.push("", "### Elevator pitch", "", memory.elevatorPitch, "");
  }
  if (memory.industry) {
    parts.push("### Industry", "", `- ${memory.industry}`, "");
  }
  if (memory.targetMember) {
    parts.push("### Target member", "", `- ${memory.targetMember}`, "");
  }
  if (memory.differentiators.length > 0) {
    parts.push("### What makes this gym different", "", ...memory.differentiators.map((d) => `- ${d}`), "");
  }
  if (memory.brandVoice) {
    parts.push("### Brand voice", "", `- ${memory.brandVoice}`, "");
  }
  if (memory.businessPriorities.length > 0) {
    parts.push("### Business priorities", "", ...memory.businessPriorities.map((p) => `- ${p}`), "");
  }
  if (memory.keyConstraints.length > 0) {
    parts.push("### Key constraints", "", ...memory.keyConstraints.map((c) => `- ${c}`), "");
  }

  if (memory.stakeholderName) {
    parts.push(
      "## About the user",
      "",
      `- **Name**: ${memory.stakeholderName}`,
      memory.stakeholderRole ? `- **Role**: ${memory.stakeholderRole}` : "",
      memory.stakeholderEmail ? `- **Email**: ${memory.stakeholderEmail}` : "",
      memory.stakeholderNotes ? `- **Notes**: ${memory.stakeholderNotes}` : "",
      "",
    );
  }

  if (memory.currentGoal) {
    parts.push("## Current goal", "", `- ${memory.currentGoal}`, "");
  }
  if (memory.brandPositioning) {
    parts.push("## Brand positioning", "", `- ${memory.brandPositioning}`, "");
  }

  parts.push(
    renderList("Locked decisions", memory.lockedDecisions),
    renderList("Known blockers", memory.knownBlockers),
    renderList("Follow-up backlog", memory.followUpBacklog),
    renderList("Reference docs", memory.referenceDocKeys.map((k) => `[[${k}]]`)),
  );

  return parts.filter(Boolean).join("\n");
}

export function renderSiteMemory(memory: SiteMemory): string {
  const parts = [
    "# Site Memory",
    "",
    "Site-specific iteration log and state. AI-maintained; user-editable.",
    "",
  ];

  if (memory.sitePurpose) parts.push("## Site purpose", "", `- ${memory.sitePurpose}`, "");
  if (memory.sourceUrl) parts.push("## Source", "", `- ${memory.sourceUrl}`, "");
  if (memory.replicationStatus) parts.push("## Replication status", "", `- ${memory.replicationStatus}`, "");
  if (memory.publishState) parts.push("## Publish state", "", `- ${memory.publishState}`, "");

  parts.push(
    renderList("Recent edits", memory.recentEdits),
    renderList("QA issues", memory.qaIssues),
    renderList("Known placeholders", memory.knownPlaceholders),
    renderList("Follow-up backlog", memory.followUpBacklog),
  );

  return parts.filter(Boolean).join("\n");
}
