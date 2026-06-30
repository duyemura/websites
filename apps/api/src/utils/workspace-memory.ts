import type { WorkspaceMemory, SiteMemory } from "@ploy-gyms/shared-types";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import type { Config } from "../plugins/env";
import type { ScrapedWebsiteData } from "./scrape-docs";
import { inferIndustry } from "./scrape-docs";
import { extractWorkspaceMemoryFields } from "../ai/prompts/workspace-memory-extraction";

export const WORKSPACE_MEMORY_DOC_KEY = "workspace-memory";
export const WORKSPACE_MEMORY_DOC_TITLE = "Workspace memory";
export const SITE_MEMORY_DOC_KEY = "site-memory";
export const SITE_MEMORY_DOC_TITLE = "Site memory";

function extractNicheKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const checks: Record<string, string[]> = {
    crossfit: ["crossfit"],
    bjj: ["brazilian jiu-jitsu", "bjj", "jiu jitsu", "grappling"],
    "strike training": ["muay thai", "kickboxing", "boxing"],
    yoga: ["yoga"],
    pilates: ["pilates"],
    barre: ["barre"],
    "spin / indoor cycling": ["spin", "indoor cycling"],
    powerlifting: ["powerlifting"],
    "olympic weightlifting": ["olympic weightlifting", "weightlifting"],
  };
  return Object.entries(checks)
    .filter(([, kws]) => kws.some((kw) => lower.includes(kw)))
    .map(([niche]) => niche);
}

function inferIndustryWithGmb(data: ScrapedWebsiteData, gmb?: GmbListing): string {
  const corpus = [
    gmb?.primaryType ?? "",
    gmb?.editorialSummary ?? "",
    data.description ?? "",
    data.tagline ?? "",
    ...data.headings.slice(0, 10),
    ...data.paragraphs.slice(0, 5),
    ...data.offerings.map((o) => `${o.name ?? ""} ${o.description ?? ""}`),
  ].join(" ");
  return inferIndustry(corpus);
}

function heuristicTargetMember(data: ScrapedWebsiteData): string {
  const offerings = data.offerings.map((o) => o.name).filter(Boolean);
  const nicheKeywords = extractNicheKeywords(
    [
      data.description ?? "",
      data.tagline ?? "",
      ...data.headings,
      ...data.paragraphs,
      ...offerings,
    ].join(" "),
  );
  if (nicheKeywords.length > 0) {
    return `People seeking ${nicheKeywords.join(", ")} training and community`;
  }
  if (offerings.length > 0) {
    return `People interested in ${offerings.join(", ").toLowerCase()}`;
  }
  return "Prospects researching the gym online";
}

function heuristicDifferentiators(data: ScrapedWebsiteData, gmb?: GmbListing): string[] {
  const differentiators: string[] = [];
  const nicheKeywords = extractNicheKeywords(
    [
      data.description ?? "",
      data.tagline ?? "",
      ...data.headings,
      ...data.paragraphs,
      ...data.offerings.map((o) => o.name ?? ""),
    ].join(" "),
  );
  if (nicheKeywords.length > 0) {
    differentiators.push(`Specialized focus: ${nicheKeywords.join(", ")}`);
  }
  if (data.locations.length > 0) {
    differentiators.push(`Local presence at ${data.locations.length} location(s)`);
  }
  if (data.team.length > 0) {
    differentiators.push(
      `Coach-led environment: ${data.team
        .map((t) => t.name)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ")}`,
    );
  }
  if (data.testimonials.length > 0) {
    differentiators.push("Social proof from member testimonials");
  }
  if (gmb?.reviews && gmb.reviews.length > 0) {
    differentiators.push(`${gmb.reviews.length} Google review(s) available for insight`);
  }
  if (differentiators.length === 0) {
    differentiators.push("Unique positioning not yet captured");
  }
  return differentiators;
}

function heuristicBrandVoice(data: ScrapedWebsiteData): string | undefined {
  if (data.description) {
    return `Inferred from source copy: ${data.description.slice(0, 120).replace(/\.$/, "")}`;
  }
  return undefined;
}

export async function generateWorkspaceMemory(
  data: ScrapedWebsiteData,
  gmb?: GmbListing,
  config?: Config,
  overrides: Partial<WorkspaceMemory> = {},
): Promise<WorkspaceMemory> {
  const industry = inferIndustryWithGmb(data, gmb);

  const businessSnapshot = [
    data.businessName ?? data.title,
    industry ? `— ${industry}` : "",
    data.tagline ? `| ${data.tagline}` : "",
    data.locations.length > 0 ? `| ${data.locations.length} location(s)` : "",
    data.offerings.length > 0
      ? `| offers ${data.offerings.map((o: { name?: string }) => o.name).filter(Boolean).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const targetMember = heuristicTargetMember(data);
  const differentiators = heuristicDifferentiators(data, gmb);
  const brandVoice = heuristicBrandVoice(data);

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

  const memory: WorkspaceMemory = {
    businessSnapshot,
    positioning: overrides.positioning,
    industry,
    targetMember,
    targetMembers: [],
    antiTargetMembers: [],
    differentiators,
    brandVoice,
    businessPriorities,
    keyConstraints,
    stakeholderName: overrides.stakeholderName,
    stakeholderRole: overrides.stakeholderRole,
    stakeholderEmail: overrides.stakeholderEmail,
    stakeholderNotes: overrides.stakeholderNotes,
    currentGoal: overrides.currentGoal ?? ctaGoal,
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

  if (config) {
    const extracted = await extractWorkspaceMemoryFields(data, gmb, industry, config);
    if (extracted) {
      if (extracted.industry) memory.industry = extracted.industry;
      if (extracted.positioning) memory.positioning = extracted.positioning;
      if (extracted.targetMembers && extracted.targetMembers.length > 0) {
        memory.targetMembers = extracted.targetMembers;
        memory.targetMember = `${extracted.targetMembers.length} ICP${
          extracted.targetMembers.length === 1 ? "" : "s"
        }: ${extracted.targetMembers.map((t) => t.name).join(", ")}`;
      }
      if (extracted.antiTargetMembers && extracted.antiTargetMembers.length > 0) {
        memory.antiTargetMembers = extracted.antiTargetMembers;
      }
      if (extracted.differentiators && extracted.differentiators.length > 0) {
        memory.differentiators = extracted.differentiators;
      }
      if (extracted.brandVoice) memory.brandVoice = extracted.brandVoice;
    }
  }

  return memory;
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

function renderIcpProfile(profile: import("@ploy-gyms/shared-types").IcpProfile, index: number): string {
  const details = [
    profile.demographics ? `*Demographics:* ${profile.demographics}` : "",
    profile.psychographics ? `*Motivation:* ${profile.psychographics}` : "",
    profile.jobsToBeDone.length > 0 ? `*Hires the gym for:* ${profile.jobsToBeDone.join("; ")}` : "",
    profile.commonObjections.length > 0 ? `*Hesitates because:* ${profile.commonObjections.join("; ")}` : "",
    profile.entrySignals.length > 0 ? `*Signals in corpus:* ${profile.entrySignals.join("; ")}` : "",
  ].filter(Boolean);

  const lines = [`**${index + 1}. ${profile.name}** — ${profile.summary}`];
  if (details.length > 0) {
    lines.push(details.map((d) => `  - ${d}`).join("\n"));
  }
  return lines.join("\n");
}

function renderAntiIcpProfile(profile: import("@ploy-gyms/shared-types").IcpProfile, index: number): string {
  return `**${index + 1}. ${profile.name}** — ${profile.summary}`;
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

  if (memory.positioning) {
    parts.push("", "### Positioning", "", memory.positioning, "");
  }
  if (memory.industry) {
    parts.push("### Industry", "", `- ${memory.industry}`, "");
  }
  if (memory.targetMember) {
    parts.push("### ICP(s)", "", `- ${memory.targetMember}`, "");
  }
  if (memory.targetMembers.length > 0) {
    parts.push(
      "#### Ideal customer profiles",
      "",
      memory.targetMembers.map((p, i) => renderIcpProfile(p, i)).join("\n\n"),
      "",
    );
  }
  if (memory.antiTargetMembers.length > 0) {
    parts.push(
      "#### Not a fit",
      "",
      memory.antiTargetMembers.map((p, i) => renderAntiIcpProfile(p, i)).join("\n\n"),
      "",
    );
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
