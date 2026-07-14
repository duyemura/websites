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
import type { WorkspaceMemory } from "@milo/shared-types";
import {
  BRAND_GUIDELINES_DOC_KEY,
  BRAND_GUIDELINES_DOC_TITLE,
  generateBrandGuidelines,
} from "../../utils/brand-guidelines";
import {
  buildBrandGuidelinesInput,
  type ScrapedWebsiteData,
} from "../../utils/scrape-docs";
import {
  buildSiteHierarchyFromSegments,
  pathToSlug,
} from "../../utils/site-hierarchy-builder";
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
import { imageUrlToDataUri, type S3Context } from "../../utils/pipeline/image-to-data-url";
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
  s3: import("@aws-sdk/client-s3").S3Client;
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
  /** Skip vision-model interaction classification — set true for template path where interaction data is unused. */
  skipVision?: boolean;
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
  s3ctx?: S3Context,
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
              { type: "image_url", image_url: { url: await imageUrlToDataUri(capture.beforeUrl, s3ctx) } },
              { type: "image_url", image_url: { url: await imageUrlToDataUri(capture.afterUrl, s3ctx) } },
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

/** Bounded concurrency ceiling for vision classification. */
const MAX_CONCURRENT_VISION = 6;
/** Hard ceiling on total classifications per docgen run to bound LLM spend. */
const MAX_CLASSIFICATIONS_PER_RUN = 100;

/**
 * Run an async worker across `items` with at most `concurrency` in-flight at
 * once. Exceptions from the worker propagate (worker is expected to swallow
 * its own errors and set fallback state).
 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];
  while (queue.length > 0 || active.length > 0) {
    while (active.length < concurrency && queue.length > 0) {
      const item = queue.shift() as T;
      const p = worker(item).finally(() => {
        const i = active.indexOf(p);
        if (i >= 0) active.splice(i, 1);
      });
      active.push(p);
    }
    if (active.length > 0) await Promise.race(active);
  }
}

async function classifyAllInteractions(
  evidence: SectionVisualEvidence,
  extract: ExtractArtifact,
  config: Config,
  s3ctx?: S3Context,
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
  // evidence row. Evidence rows carry the source InteractionCapture id, so we
  // can key directly by id (O(N)) instead of scanning captures by URL (O(N·M)).
  const needed = new Set<string>();
  for (const row of evidence.rows) {
    if (!row.interactionCaptures) continue;
    for (const target of row.interactionCaptures) {
      if (target.id && captureById.has(target.id)) needed.add(target.id);
    }
  }

  // Bound total classifications per run so a pathological site (dozens of
  // pages × dozens of interactions) cannot blow up vision-model spend.
  let neededIds = [...needed];
  if (neededIds.length > MAX_CLASSIFICATIONS_PER_RUN) {
    console.warn(
      `[docgen] classification queue length ${neededIds.length} exceeds cap ${MAX_CLASSIFICATIONS_PER_RUN}; truncating`,
    );
    neededIds = neededIds.slice(0, MAX_CLASSIFICATIONS_PER_RUN);
  }

  await runPool(neededIds, MAX_CONCURRENT_VISION, async (id) => {
    const cap = captureById.get(id);
    if (!cap) return;
    const pattern = await classifyInteraction(cap, config, s3ctx);
    patternById.set(id, pattern);
  });

  const rows = evidence.rows.map((row) => {
    if (!row.interactionCaptures || row.interactionCaptures.length === 0) return row;
    const enriched: InteractionEvidenceCapture[] = row.interactionCaptures.map((cap) => {
      if (!cap.id) return cap;
      const pattern = patternById.get(cap.id);
      return pattern ? { ...cap, componentPattern: pattern } : cap;
    });
    return { ...row, interactionCaptures: enriched };
  });

  return { version: evidence.version, rows };
}

/**
 * Hybrid-mode evidence remap.
 *
 * In hybrid ("template") mode the site hierarchy is built from the content
 * site's segments (content-side section ids), but the raw section-visual-
 * evidence is built from the design site's segments (design-side section ids).
 * Those id spaces are disjoint, so every content-side `HierarchySection.
 * evidenceId` would dangle against the emitted evidence doc.
 *
 * Fix: for each content-side section, look up a design-side evidence row with
 * the same canonical `tag`. Prefer a same-slug match; fall back to the first
 * globally. Emit a copy of that design row keyed by the CONTENT-side section
 * id (evidenceId + sectionId) so the join lines up. Content sections without
 * a tag-matching design row emit no evidence row — renderVisualBlock falls
 * back to design-system rules.
 */
export function mapEvidenceForHybrid(
  hierarchy: SiteHierarchy,
  designSegment: SegmentArtifact,
  designEvidence: SectionVisualEvidence,
): SectionVisualEvidence {
  // Build a design-side lookup: design section id -> tag, and design section
  // id -> pageSlug (via the design segment). This lets us match by tag with a
  // same-slug preference without depending on evidence row ordering.
  const designTagById = new Map<string, string>();
  const designSlugById = new Map<string, string>();
  for (const dp of designSegment.pages) {
    const slug = pathToSlug(dp.path);
    for (const s of dp.sections) {
      designTagById.set(s.id, s.tag);
      designSlugById.set(s.id, slug);
    }
  }
  // Evidence rows keyed by design section id for quick lookup.
  const designRowById = new Map(
    designEvidence.rows.map((r) => [r.sectionId, r] as const),
  );
  // Group design rows by tag, preserving per-slug order, so we can prefer a
  // same-slug match.
  const rowsByTag = new Map<string, typeof designEvidence.rows>();
  for (const row of designEvidence.rows) {
    const tag = designTagById.get(row.sectionId);
    if (!tag) continue;
    const bucket = rowsByTag.get(tag);
    if (bucket) bucket.push(row);
    else rowsByTag.set(tag, [row]);
  }

  const mapped: SectionVisualEvidence["rows"] = [];
  for (const page of hierarchy.pages) {
    for (const section of page.sections) {
      const bucket = rowsByTag.get(section.tag);
      if (!bucket || bucket.length === 0) continue;
      // Prefer a design row on the same slug when one exists.
      const sameSlug = bucket.find(
        (r) => designSlugById.get(r.sectionId) === page.slug,
      );
      const chosen = sameSlug ?? bucket[0]!;
      const source = designRowById.get(chosen.sectionId) ?? chosen;
      mapped.push({
        evidenceId: section.evidenceId,
        pageSlug: page.slug,
        sectionId: section.id,
        screenshotUrl: source.screenshotUrl,
        mobileScreenshotUrl: source.mobileScreenshotUrl,
        contextScreenshotUrl: source.contextScreenshotUrl,
        boundingBox: source.boundingBox,
        computedStyles: source.computedStyles,
        domSnippet: source.domSnippet,
        layoutHint: source.layoutHint,
        mediaUrls: source.mediaUrls,
        interactionCaptures: source.interactionCaptures,
      });
    }
  }

  return { version: designEvidence.version, rows: mapped };
}

function buildSitePlaybookSection(
  extract: ExtractArtifact,
  workspaceMemory?: WorkspaceMemory,
): string {
  const idealAction = "Book a free intro or tour";
  const offer = "Free intro or trial class";
  const icpSummary = workspaceMemory?.targetMember ?? "Prospects researching local fitness options";
  const topObjections = workspaceMemory?.targetMembers
    ?.flatMap((p) => p.commonObjections)
    .filter(Boolean)
    .slice(0, 3) ?? [];
  const differentiators = workspaceMemory?.differentiators?.slice(0, 3)
    ?? workspaceMemory?.businessPriorities?.slice(0, 3)
    ?? [];

  const trustAssets: string[] = [];
  // Extract artifact does not carry review count directly; business-info doc holds trust signals.
  trustAssets.push("See [[business-info]] for verified testimonials, ratings, and credentials.");

  const voice = workspaceMemory?.brandVoice ?? "Friendly, credible, and action-oriented.";

  const lines: string[] = [
    "## Site playbook",
    "",
    "This section is the conversion brief for the site. Every page generator should read it before writing copy.",
    "",
    "### Conversion goal",
    "",
    "- Drive the primary conversion action on every page.",
    "",
    "### Ideal first action",
    "",
    `- ${idealAction}`,
    "",
    "### Offer / hook",
    "",
    `- ${offer}`,
    "",
    "### Ideal customer profile",
    "",
    `- ${icpSummary}`,
  ];

  if (topObjections.length > 0) {
    lines.push("", "### Common objections to overcome", "", ...topObjections.map((o) => `- ${o}`));
  }

  if (differentiators.length > 0) {
    lines.push("", "### Differentiators to echo on every page", "", ...differentiators.map((d) => `- ${d}`));
  }

  lines.push(
    "",
    "### Trust assets available",
    "",
    trustAssets.length > 0 ? trustAssets.map((a) => `- ${a}`).join("\n") : "- No verified trust assets captured yet.",
    "",
    "### Voice rules",
    "",
    `- ${voice}`,
    "- Use sentence case for buttons, labels, and body copy.",
    "- Mention the gym name and city naturally, at most once per section.",
    "- Never promise specific results or invent prices, schedules, or guarantees.",
    "- Every page should end with one clear call to action.",
  );

  return lines.join("\n");
}

function makeSiteStrategyDoc(
  extract: ExtractArtifact,
  hierarchy: SiteHierarchy,
  workspaceMemory?: WorkspaceMemory,
): GeneratedSiteDoc {
  const businessName = extract.pages[0]?.content.businessName ?? extract.url;
  const pages = hierarchy.pages
    .map((p) => `- \`${p.slug}\`${p.isHomePage ? " (home)" : ""} — ${p.title}`)
    .join("\n");
  const playbook = buildSitePlaybookSection(extract, workspaceMemory);
  const content = `# Site strategy for ${businessName}

## Goal

Build an Astro static site that faithfully represents ${businessName}, converts visitors into leads, and gives the gym a reliable, editable foundation.

${playbook}

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
  // Hybrid mode (content site !== design site): remap design-side evidence
  // rows so their evidenceId/sectionId keys line up with the content-side
  // hierarchy sections. Otherwise every hierarchy section's evidenceId would
  // dangle against the emitted evidence doc.
  const isHybrid = contentCtx.siteUuid !== designCtx.siteUuid;
  const alignedEvidence = isHybrid
    ? mapEvidenceForHybrid(hierarchy, designSegment, rawEvidence)
    : rawEvidence;
  const s3ctx: S3Context = {
    s3: input.s3,
    bucket: config.S3_ASSETS_BUCKET,
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
  };
  const enrichedEvidence = input.skipVision
    ? alignedEvidence
    : await classifyAllInteractions(alignedEvidence, designExtract, config, s3ctx);

  const searchPresence = buildSearchPresence(contentExtract);

  const businessInfoDoc = makeFallbackBusinessInfoDoc(contentExtract);
  const siteStrategyDoc = makeSiteStrategyDoc(contentExtract, hierarchy, workspaceMemory);

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
