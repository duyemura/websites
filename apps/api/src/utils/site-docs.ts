import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import {
  generateBrandGuidelines,
  BRAND_GUIDELINES_DOC_KEY,
  BRAND_GUIDELINES_DOC_TITLE,
} from "./brand-guidelines";
import { assertAllowedDocKey } from "./doc-registry";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import { buildBrandGuidelinesInput, type ScrapedWebsiteData } from "./scrape-docs";
import { buildSiteBlueprint } from "./site-blueprint";
import {
  generateSiteMemory,
  generateWorkspaceMemory,
  renderSiteMemory,
  renderWorkspaceMemory,
  SITE_MEMORY_DOC_KEY,
  SITE_MEMORY_DOC_TITLE,
  WORKSPACE_MEMORY_DOC_KEY,
  WORKSPACE_MEMORY_DOC_TITLE,
} from "./workspace-memory";

export interface GeneratedSiteDoc {
  key: string;
  title: string;
  content: string;
  source: "ai_extracted";
}

export interface DocGenerationContext {
  scraped: ScrapedWebsiteData;
  gmb?: GmbListing;
}

function validateGeneratedDocs(docs: GeneratedSiteDoc[]): void {
  for (const doc of docs) {
    assertAllowedDocKey(doc.key);
  }
}

function formatGmbHours(hours: { day: string; open?: string; close?: string; isClosed?: boolean }[]): string {
  return hours
    .map((h) => {
      const label = h.day.charAt(0) + h.day.slice(1).toLowerCase();
      if (h.isClosed || !h.open) return `${label}: Closed`;
      const close = h.close ?? "—";
      return `${label}: ${h.open}–${close}`;
    })
    .join("\n");
}

function makeBusinessInfoDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const { scraped, gmb } = ctx;
  const businessName = gmb?.name ?? scraped.businessName ?? scraped.title;

  const lines = [
    `# ${businessName}`,
    "",
    gmb?.editorialSummary || scraped.tagline ? `**Tagline**: ${gmb?.editorialSummary || scraped.tagline}` : "",
    gmb?.editorialSummary ? `**About**: ${gmb.editorialSummary}` : "",
    scraped.description ? `**Description**: ${scraped.description}` : "",
  ].filter(Boolean);

  const externalProfiles: { label: string; url: string }[] = [];
  if (gmb?.googleMapsUri) externalProfiles.push({ label: "Google Maps", url: gmb.googleMapsUri });
  if (gmb?.websiteUri) externalProfiles.push({ label: "Website", url: gmb.websiteUri });
  for (const social of scraped.contact?.social ?? []) {
    externalProfiles.push({ label: social.platform, url: social.url });
  }

  if (externalProfiles.length > 0) {
    lines.push("", "## External profiles", "");
    for (const p of externalProfiles) {
      lines.push(`- ${p.label}: ${p.url}`);
    }
  }

  if (gmb?.rating != null) {
    lines.push(
      "",
      "## Google Business Profile",
      "",
      `- **Rating**: ${gmb.rating} / 5${gmb.userRatingCount != null ? ` (${gmb.userRatingCount} reviews)` : ""}`,
      gmb.primaryType ? `- **Primary category**: ${gmb.primaryType}` : "",
      gmb.businessStatus ? `- **Status**: ${gmb.businessStatus}` : "",
    );
  }

  if (gmb?.address || gmb?.regularOpeningHours?.length) {
    lines.push("", "## Location", "");
    if (gmb.address) {
      const { streetNumber, streetName, city, state, postalCode } = gmb.address;
      const street = [streetNumber, streetName].filter(Boolean).join(" ");
      const parts = [street, city, state, postalCode].filter(Boolean);
      if (parts.length > 0) lines.push(`- **Address**: ${parts.join(", ")}`);
    }
    if (gmb.regularOpeningHours?.length) {
      lines.push("", "**Hours**", "");
      for (const h of formatGmbHours(gmb.regularOpeningHours).split("\n")) {
        lines.push(`- ${h}`);
      }
    }
  }

  const hasPhone = gmb?.phoneNumber || scraped.contact?.phone;
  const hasEmail = scraped.contact?.email;
  if (hasPhone || hasEmail) {
    lines.push("", "## Contact", "");
    if (gmb?.phoneNumber) lines.push(`- **Phone**: ${gmb.phoneNumber}`);
    else if (scraped.contact?.phone) lines.push(`- **Phone**: ${scraped.contact.phone}`);
    if (scraped.contact?.email) lines.push(`- **Email**: ${scraped.contact.email}`);
  }

  if (scraped.offerings.length > 0) {
    lines.push(
      "",
      "## Offerings",
      "",
      ...scraped.offerings.map((o) => {
        const parts = [o.name, o.description, o.price].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  if (scraped.locations.length > 0) {
    lines.push(
      "",
      "## Locations",
      "",
      ...scraped.locations.map((loc) => {
        const parts = [loc.name, loc.address, loc.hours].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  if (scraped.team.length > 0) {
    lines.push(
      "",
      "## Team",
      "",
      ...scraped.team.map((t) => {
        const parts = [t.name, t.role, t.bio].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  const testimonials =
    scraped.testimonials.length > 0
      ? scraped.testimonials
      : (gmb?.reviews ?? []).map((r) => ({
          quote: r.text ?? "",
          author: r.author,
          role: undefined,
        }));

  if (testimonials.length > 0) {
    lines.push(
      "",
      "## Testimonials",
      "",
      ...testimonials.map((t) => {
        const attribution = [t.author, t.role].filter(Boolean).join(", ");
        return `> "${t.quote}"${attribution ? ` — ${attribution}` : ""}`;
      }),
    );
  }

  if (scraped.faqs.length > 0) {
    lines.push(
      "",
      "## FAQs",
      "",
      ...scraped.faqs.flatMap((f) => [`### ${f.question}`, "", f.answer, ""]),
    );
  }

  return {
    key: "business-info",
    title: "Business info",
    content: lines.filter(Boolean).join("\n"),
    source: "ai_extracted",
  };
}

function makeSiteStrategyDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const { scraped, gmb } = ctx;
  const businessName = gmb?.name ?? scraped.businessName ?? scraped.title;

  const navLines = scraped.navLinks.length
    ? scraped.navLinks.map((link) => `- [${link.label}](${link.href})`).join("\n")
    : "- No navigation links detected.";

  const sourceFacts: string[] = [];
  if (gmb) {
    sourceFacts.push(`Google Business Profile verified as ${gmb.name}.`);
    if (gmb.primaryType) sourceFacts.push(`Primary category: ${gmb.primaryType}.`);
    if (gmb.rating != null) sourceFacts.push(`Rating: ${gmb.rating} / 5.`);
    if (gmb.photos.length > 0) sourceFacts.push(`${gmb.photos.length} GMB photos available for asset curation.`);
  }
  if (scraped.url) sourceFacts.push(`Source website: ${scraped.url}.`);

  return {
    key: "site-strategy",
    title: "Site strategy",
    content: `# Site strategy for ${businessName}

## Goal
Build an Astro static site that accurately represents ${businessName} and gives the gym a reliable, editable foundation for future pages.

## Verified source facts

${sourceFacts.length > 0 ? sourceFacts.map((f) => `- ${f}`).join("\n") : "- No verified external sources available."}

## Source

- URL: ${scraped.url}

## Site structure

### Navigation

${navLines}

### Pages to build

- **Homepage** — gate page. Must include hero, social proof, and primary CTA.
- **About / Coaches** — optional if team data is strong.
- **Services / Classes** — optional if offerings are complex.
- **Contact / Location** — optional if location or contact is unique.

Build only what the source site and business info justify. Prefer fewer, stronger pages over empty placeholders.

## Build phases

1. **Discovery** (done) — GMB listing resolved and website scraped.
2. **Blueprint** — emit a JSON site blueprint with design tokens, pages, and sections.
3. **Assets** — resolve/download/generate all images, fonts, and icons.
4. **Code** — generate Astro + Tailwind source from the blueprint.
5. **Build/QA** — run \`astro build\` and automated checks.
6. **Review/Publish** — human review gate and publish.

## Decisions to confirm

- Which pages to build first (homepage is the gate).
- Whether to reuse scraped images or generate replacements.
- Any business details that need correction.

## Next action

Generate the homepage blueprint from the docs in this workspace and the screenshot asset.
`,
    source: "ai_extracted",
  };
}

function makeBlueprintDraftDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const blueprint = buildSiteBlueprint(ctx.scraped);
  return {
    key: "blueprint-draft",
    title: "Blueprint draft",
    content: `# Blueprint draft

This doc holds the initial JSON blueprint derived from the scraped source site.

## Site blueprint

\`\`\`json
${JSON.stringify(blueprint, null, 2)}
\`\`\`
`,
    source: "ai_extracted",
  };
}

export function generateSiteDocs(
  data: ScrapedWebsiteData,
  gmb?: GmbListing,
): GeneratedSiteDoc[] {
  const ctx: DocGenerationContext = { scraped: data, gmb };
  const brandInput = buildBrandGuidelinesInput(ctx);
  const workspaceMemory = generateWorkspaceMemory(data);
  const siteMemory = generateSiteMemory(data);

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
    makeBusinessInfoDoc(ctx),
    makeSiteStrategyDoc(ctx),
    makeBlueprintDraftDoc(ctx),
  ];

  validateGeneratedDocs(docs);
  return docs;
}

/**
 * Docs that are workspace-scoped rather than tied to a single site.
 */
const WORKSPACE_DOC_KEYS = new Set([
  "workspace-memory",
  "brand-guidelines",
]);

function docSiteUuid(doc: GeneratedSiteDoc, siteUuid?: string): string | null {
  return WORKSPACE_DOC_KEYS.has(doc.key) ? null : (siteUuid ?? null);
}

export async function saveSiteDocs(
  db: Kysely<DB>,
  workspaceUuid: string,
  docs: GeneratedSiteDoc[],
  siteUuid?: string,
): Promise<void> {
  validateGeneratedDocs(docs);

  for (const doc of docs) {
    const docSite = docSiteUuid(doc, siteUuid);
    const existing = await db
      .selectFrom("docs")
      .select("uuid")
      .where("workspaceUuid", "=", workspaceUuid)
      .where("key", "=", doc.key)
      .where("siteUuid", docSite ? "=" : "is", docSite)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("docs")
        .set({
          title: doc.title,
          content: doc.content,
          source: doc.source,
          status: "active",
          updatedAt: new Date(),
          siteUuid: docSite,
        })
        .where("uuid", "=", existing.uuid)
        .execute();
    } else {
      await db
        .insertInto("docs")
        .values({
          workspaceUuid,
          key: doc.key,
          title: doc.title,
          content: doc.content,
          source: doc.source,
          status: "active",
          siteUuid: docSite,
        })
        .execute();
    }
  }
}
