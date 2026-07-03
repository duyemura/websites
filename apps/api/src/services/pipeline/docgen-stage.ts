import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import {
  loadArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";
import type {
  ExtractArtifact,
  SegmentArtifact,
  InteractionCapture,
} from "../../types/pipeline-artifacts";
import type { GeneratedSiteDoc } from "../../utils/site-docs";
import {
  generateWorkspaceMemory,
  generateSiteMemory,
  renderWorkspaceMemory,
  renderSiteMemory,
  WORKSPACE_MEMORY_DOC_KEY,
  WORKSPACE_MEMORY_DOC_TITLE,
  SITE_MEMORY_DOC_KEY,
  SITE_MEMORY_DOC_TITLE,
  type WorkspaceMemoryContext,
} from "../../utils/workspace-memory";
import {
  BRAND_GUIDELINES_DOC_KEY,
  BRAND_GUIDELINES_DOC_TITLE,
  generateBrandGuidelines,
} from "../../utils/brand-guidelines";
import {
  buildBrandGuidelinesInput,
  type ScrapedWebsiteData,
} from "../../utils/scrape-docs";
import { buildSiteHierarchyFromSegments } from "../../utils/site-hierarchy-builder";
import { buildDesignSystemFromExtract } from "../../utils/design-system-builder";
import { buildSectionVisualEvidenceFromSegments } from "../../utils/section-visual-evidence-builder";
import {
  buildSearchPresence,
  buildEmptySearchPresence,
  SEARCH_PRESENCE_DOC_KEY,
  SEARCH_PRESENCE_DOC_TITLE,
} from "../../utils/search-presence-builder";
import {
  SITE_HIERARCHY_DOC_KEY,
  SITE_HIERARCHY_DOC_TITLE,
} from "../../utils/site-hierarchy-io";
import {
  DESIGN_SYSTEM_DOC_KEY,
  DESIGN_SYSTEM_DOC_TITLE,
} from "../../utils/design-system-io";
import {
  SECTION_VISUAL_EVIDENCE_DOC_KEY,
  SECTION_VISUAL_EVIDENCE_DOC_TITLE,
} from "../../utils/section-visual-evidence-io";
import {
  assertAllowedDocKey,
} from "../../utils/doc-registry";
import { generateSiteDocsForGreenfield } from "../../utils/site-docs";
import { chatCompletion } from "../../ai/llm-client";
import { modelForTask } from "../../ai/model-picker";
import type { SectionVisualEvidence, InteractionEvidenceCapture, InteractionComponentPattern } from "../../types/section-visual-evidence";
import type { SiteHierarchy } from "../../types/site-hierarchy";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type { SearchPresence } from "../../utils/search-presence-builder";

const SITE_STRATEGY_DOC_KEY = "site-strategy";
const SITE_STRATEGY_DOC_TITLE = "Site strategy";
const BUSINESS_INFO_DOC_KEY = "business-info";
const BUSINESS_INFO_DOC_TITLE = "Business info";

export interface DocgenStageInput {
  db: Kysely<DB>;
  config: Config;
  siteUuid: string;
  workspaceUuid: string;
  /** Site-generation mode: replication (clone), template (hybrid), or greenfield. */
  mode: "replication" | "template" | "greenfield";
  /** For hybrid mode: siteUuid whose extract/segment supplies content. Defaults to siteUuid. */
  contentSiteUuid?: string;
  /** For hybrid mode: siteUuid whose extract/segment supplies design. Defaults to siteUuid. */
  designSiteUuid?: string;
  /** For greenfield mode. */
  greenfield?: {
    site: { uuid: string; name: string; workspaceUuid: string };
    brandMemory: { primaryColor?: string; fontHeading?: string; fontBody?: string };
    businessInput: { businessName: string; tagline?: string; description?: string };
  };
  /** Optional context for AI-driven workspace memory extraction. */
  workspaceMemoryCtx?: WorkspaceMemoryContext;
}

async function loadStageArtifact<T>(
  db: Kysely<DB>,
  ctx: ArtifactContext,
  stage: "extract" | "segment",
): Promise<T> {
  const stored = await loadArtifact<T>(db, ctx, stage);
  if (!stored) {
    throw new Error(
      `No ${stage} artifact found for site ${ctx.siteUuid}. Run the ${stage} stage first.`,
    );
  }
  return stored.payload;
}

/**
 * Build a minimal ScrapedWebsiteData adapter from an ExtractArtifact so we can
 * reuse the workspace-memory, site-memory, brand-guidelines, and business-info
 * doc generators that were written against the scrape-based pipeline.
 *
 * The adapter carries the fields those generators actually read; anything else
 * is safely defaulted to empty arrays/undefined.
 */
function adaptExtractToScraped(extract: ExtractArtifact): ScrapedWebsiteData {
  const first = extract.pages[0];
  const headings = extract.pages.flatMap((p) =>
    p.content.headings.map((h) => h.text),
  );
  const meta = first?.content.meta ?? {};

  return {
    url: extract.url,
    title: first?.content.title ?? "",
    description: meta["description"] ?? meta["og:description"],
    businessName: first?.content.businessName,
    tagline: undefined,
    headings,
    paragraphs: [],
    buttons: [],
    navLinks: first?.content.navLinks ?? [],
    colors: [],
    fonts: [],
    fontSizes: [],
    images: [],
    layoutRules: [],
    faqs: [],
    testimonials: [],
    locations: [],
    team: [],
    offerings: [],
    contact: {},
  };
}

function makeJsonDocContent(title: string, description: string, value: unknown): string {
  return `# ${title}\n\n${description}\n\n## ${title.toLowerCase()}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function renderSearchPresenceDoc(sp: SearchPresence): string {
  return makeJsonDocContent(
    "Search presence",
    "Per-page SEO/AEO snapshot: meta tags, headings, schema types, sitemap presence, and the source baseline from the extract stage.",
    sp,
  );
}

function renderHierarchyDoc(hierarchy: SiteHierarchy): string {
  return makeJsonDocContent(
    "Site hierarchy",
    "Semantic page/section hierarchy derived from the segment artifact.",
    hierarchy,
  );
}

function renderDesignSystemDoc(ds: DesignSystemV2): string {
  return makeJsonDocContent(
    "Design system",
    "Locked global design system used to build every page.",
    ds,
  );
}

function renderSectionVisualEvidenceDoc(evidence: SectionVisualEvidence): string {
  return makeJsonDocContent(
    "Section visual evidence",
    "Per-section crops, mobile crops, media, and interaction captures.",
    evidence,
  );
}

const VALID_PATTERNS: InteractionComponentPattern[] = [
  "dropdown",
  "accordion",
  "tab",
  "modal",
  "drawer",
  "tooltip",
  "other",
];

async function classifyInteraction(
  capture: InteractionCapture,
  config: Config,
): Promise<InteractionComponentPattern | undefined> {
  try {
    const response = await chatCompletion(
      {
        model: modelForTask("vision", config),
        temperature: 0,
        maxTokens: 12,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Compare these before/after screenshots of a UI interaction. Return one word: dropdown, accordion, tab, modal, drawer, tooltip, or other.",
              },
              { type: "image_url", image_url: { url: capture.beforeUrl } },
              { type: "image_url", image_url: { url: capture.afterUrl } },
            ],
          },
        ],
      },
      config,
    );
    const raw = (response.content ?? "").trim().toLowerCase();
    const cleaned = raw.replace(/[^a-z]/g, "");
    const match = VALID_PATTERNS.find((p) => cleaned === p);
    return match;
  } catch (err) {
    // Non-fatal: build stage falls back to a generic toggle when the pattern
    // is missing. Log a note but don't fail the whole stage.
    console.warn(
      `[docgen] interaction classification failed for ${capture.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

async function classifyAllInteractions(
  evidence: SectionVisualEvidence,
  extract: ExtractArtifact,
  config: Config,
): Promise<SectionVisualEvidence> {
  const captureById = new Map<string, InteractionCapture>();
  for (const page of extract.pages) {
    for (const cap of page.interactions) {
      captureById.set(cap.id, cap);
    }
  }
  // Deduplicate classification by interaction id (captured in the extract
  // artifact) so re-runs and multiple sections that share an id only pay once.
  const patternById = new Map<string, InteractionComponentPattern | undefined>();

  // Kick off classification only for interactions that actually appear on an
  // evidence row.
  const needed = new Set<string>();
  for (const row of evidence.rows) {
    if (!row.interactionCaptures) continue;
    for (let i = 0; i < row.interactionCaptures.length; i += 1) {
      // Interaction rows carry the capture object but not the id, so match by
      // beforeUrl/afterUrl against the extract capture map.
      const target = row.interactionCaptures[i]!;
      const source = [...captureById.values()].find(
        (c) => c.beforeUrl === target.beforeUrl && c.afterUrl === target.afterUrl,
      );
      if (source) needed.add(source.id);
    }
  }

  for (const id of needed) {
    const cap = captureById.get(id);
    if (!cap) continue;
    patternById.set(id, await classifyInteraction(cap, config));
  }

  const rows = evidence.rows.map((row) => {
    if (!row.interactionCaptures || row.interactionCaptures.length === 0) return row;
    const enriched: InteractionEvidenceCapture[] = row.interactionCaptures.map((cap) => {
      const source = [...captureById.values()].find(
        (c) => c.beforeUrl === cap.beforeUrl && c.afterUrl === cap.afterUrl,
      );
      if (!source) return cap;
      const pattern = patternById.get(source.id);
      return pattern ? { ...cap, componentPattern: pattern } : cap;
    });
    return { ...row, interactionCaptures: enriched };
  });

  return { version: evidence.version, rows };
}

function makeSiteStrategyDoc(
  extract: ExtractArtifact,
  hierarchy: SiteHierarchy,
): GeneratedSiteDoc {
  const businessName = extract.pages[0]?.content.businessName ?? extract.url;
  const pages = hierarchy.pages
    .map((p) => `- \`${p.slug}\`${p.isHomePage ? " (home)" : ""} — ${p.title}`)
    .join("\n");
  const content = `# Site strategy for ${businessName}

## Goal

Build an Astro static site that faithfully represents ${businessName} and gives the gym a reliable, editable foundation.

## Source

- URL: ${extract.url}
- Extract captured at: ${extract.extractedAt}
- Pages captured: ${extract.usage.pagesCaptured}

## Pages planned

${pages || "- (no pages discovered)"}

## Build order

${hierarchy.buildPlan.buildOrder.map((slug) => `1. ${slug}`).join("\n")}

## Next action

Build the homepage first, then advance through the remaining pages once approved.
`;
  return {
    key: SITE_STRATEGY_DOC_KEY,
    title: SITE_STRATEGY_DOC_TITLE,
    content,
    source: "ai_extracted",
  };
}

function makeFallbackBusinessInfoDoc(extract: ExtractArtifact): GeneratedSiteDoc {
  const first = extract.pages[0];
  const meta = first?.content.meta ?? {};
  const businessName = first?.content.businessName ?? first?.content.title ?? extract.url;
  const description = meta["description"] ?? meta["og:description"];
  const lines = [
    `# ${businessName}`,
    "",
    description ? `**Description**: ${description}` : "",
    "",
    "## Source",
    "",
    `- URL: ${extract.url}`,
    "",
    "## Headings observed",
    "",
    first?.content.headings.slice(0, 20).map((h) => `- (h${h.level}) ${h.text}`).join("\n") || "- (none)",
  ].filter(Boolean).join("\n");
  return {
    key: BUSINESS_INFO_DOC_KEY,
    title: BUSINESS_INFO_DOC_TITLE,
    content: lines,
    source: "ai_extracted",
  };
}

/**
 * Run the doc-generation stage. Produces the 9 site docs from the extract +
 * segment artifacts.
 *
 * Modes:
 * - `replication` (clone): all 9 docs from the site's own artifacts
 * - `template` (hybrid): content docs from contentSiteUuid, design docs from
 *   designSiteUuid (falls back to the site's own artifacts when unspecified)
 * - `greenfield`: reuses generateSiteDocsForGreenfield and augments with an
 *   empty search-presence doc
 */
export async function runDocgenStage(
  input: DocgenStageInput,
): Promise<GeneratedSiteDoc[]> {
  const { db, config, siteUuid, workspaceUuid, mode } = input;

  if (mode === "greenfield") {
    if (!input.greenfield) {
      throw new Error("Greenfield mode requires input.greenfield to be provided.");
    }
    const base = generateSiteDocsForGreenfield(
      input.greenfield.site,
      input.greenfield.brandMemory,
      input.greenfield.businessInput,
    );
    const emptySp = buildEmptySearchPresence(new Date().toISOString());
    const searchPresenceDoc: GeneratedSiteDoc = {
      key: SEARCH_PRESENCE_DOC_KEY,
      title: SEARCH_PRESENCE_DOC_TITLE,
      content: renderSearchPresenceDoc(emptySp),
      source: "ai_extracted",
    };
    // Ensure the greenfield-produced docs are still valid and add search-presence.
    const combined = [...base, searchPresenceDoc];
    for (const d of combined) assertAllowedDocKey(d.key);
    return combined;
  }

  const contentCtx: ArtifactContext = {
    siteUuid: input.contentSiteUuid ?? siteUuid,
    workspaceUuid,
  };
  const designCtx: ArtifactContext = {
    siteUuid: input.designSiteUuid ?? siteUuid,
    workspaceUuid,
  };

  const contentExtract = await loadStageArtifact<ExtractArtifact>(db, contentCtx, "extract");
  const contentSegment = await loadStageArtifact<SegmentArtifact>(db, contentCtx, "segment");
  const designExtract =
    designCtx.siteUuid === contentCtx.siteUuid
      ? contentExtract
      : await loadStageArtifact<ExtractArtifact>(db, designCtx, "extract");
  const designSegment =
    designCtx.siteUuid === contentCtx.siteUuid
      ? contentSegment
      : await loadStageArtifact<SegmentArtifact>(db, designCtx, "segment");

  // Content-source docs
  const scrapedAdapter = adaptExtractToScraped(contentExtract);
  const workspaceMemory = await generateWorkspaceMemory(
    scrapedAdapter,
    undefined,
    config,
    input.workspaceMemoryCtx,
  );
  const siteMemory = generateSiteMemory(scrapedAdapter);
  const brandInput = buildBrandGuidelinesInput({ scraped: scrapedAdapter });

  const hierarchy = buildSiteHierarchyFromSegments(
    contentSegment,
    contentExtract,
    mode,
  );

  // Design-source docs (design system + section visual evidence)
  const designSystem = buildDesignSystemFromExtract(
    designExtract,
    designSegment,
    designExtract.pages[0]?.screenshots.full1440 ?? null,
    mode,
  );
  const rawEvidence = buildSectionVisualEvidenceFromSegments(
    designSegment,
    designExtract,
  );
  const enrichedEvidence = await classifyAllInteractions(
    rawEvidence,
    designExtract,
    config,
  );

  const searchPresence = buildSearchPresence(contentExtract);

  const businessInfoDoc = makeFallbackBusinessInfoDoc(contentExtract);
  const siteStrategyDoc = makeSiteStrategyDoc(contentExtract, hierarchy);

  const docs: GeneratedSiteDoc[] = [
    {
      key: WORKSPACE_MEMORY_DOC_KEY,
      title: WORKSPACE_MEMORY_DOC_TITLE,
      content: renderWorkspaceMemory(workspaceMemory),
      source: "ai_extracted",
    },
    {
      key: SITE_MEMORY_DOC_KEY,
      title: SITE_MEMORY_DOC_TITLE,
      content: renderSiteMemory(siteMemory),
      source: "ai_extracted",
    },
    {
      key: BRAND_GUIDELINES_DOC_KEY,
      title: BRAND_GUIDELINES_DOC_TITLE,
      content: generateBrandGuidelines(brandInput),
      source: "ai_extracted",
    },
    businessInfoDoc,
    siteStrategyDoc,
    {
      key: SITE_HIERARCHY_DOC_KEY,
      title: SITE_HIERARCHY_DOC_TITLE,
      content: renderHierarchyDoc(hierarchy),
      source: "ai_extracted",
    },
    {
      key: DESIGN_SYSTEM_DOC_KEY,
      title: DESIGN_SYSTEM_DOC_TITLE,
      content: renderDesignSystemDoc(designSystem),
      source: "ai_extracted",
    },
    {
      key: SECTION_VISUAL_EVIDENCE_DOC_KEY,
      title: SECTION_VISUAL_EVIDENCE_DOC_TITLE,
      content: renderSectionVisualEvidenceDoc(enrichedEvidence),
      source: "ai_extracted",
    },
    {
      key: SEARCH_PRESENCE_DOC_KEY,
      title: SEARCH_PRESENCE_DOC_TITLE,
      content: renderSearchPresenceDoc(searchPresence),
      source: "ai_extracted",
    },
  ];

  for (const d of docs) assertAllowedDocKey(d.key);
  return docs;
}
