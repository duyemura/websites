import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { generateBrandGuidelines, BRAND_GUIDELINES_DOC_KEY, BRAND_GUIDELINES_DOC_TITLE } from "./brand-guidelines";
import { buildBrandGuidelinesInput, type ScrapedWebsiteData } from "./scrape-docs";
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

function makeBusinessInfoDoc(data: ScrapedWebsiteData): GeneratedSiteDoc {
  const lines = [
    `# ${data.businessName ?? data.title}`,
    "",
    data.tagline ? `**Tagline**: ${data.tagline}` : "",
    data.description ? `**Description**: ${data.description}` : "",
    data.contact?.phone ? `**Phone**: ${data.contact.phone}` : "",
    data.contact?.email ? `**Email**: ${data.contact.email}` : "",
  ].filter(Boolean);

  if (data.contact?.social && data.contact.social.length > 0) {
    lines.push("", "## Social links", "");
    for (const social of data.contact.social) {
      lines.push(`- ${social.platform}: ${social.url}`);
    }
  }

  if (data.offerings.length > 0) {
    lines.push(
      "",
      "## Offerings",
      "",
      ...data.offerings.map((o) => {
        const parts = [o.name, o.description, o.price].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  if (data.locations.length > 0) {
    lines.push(
      "",
      "## Locations",
      "",
      ...data.locations.map((loc) => {
        const parts = [loc.name, loc.address, loc.hours].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  return {
    key: "business-info",
    title: "Business info",
    content: lines.join("\n"),
    source: "ai_extracted",
  };
}

function makeTeamDoc(data: ScrapedWebsiteData): GeneratedSiteDoc | null {
  if (data.team.length === 0) return null;
  const lines = data.team.map((t) => {
    const parts = [t.name, t.role, t.bio].filter(Boolean);
    return `- ${parts.join(" — ")}`;
  });
  return {
    key: "team-bios",
    title: "Team bios",
    content: lines.join("\n"),
    source: "ai_extracted",
  };
}

function makeTestimonialsDoc(data: ScrapedWebsiteData): GeneratedSiteDoc | null {
  if (data.testimonials.length === 0) return null;
  const lines = data.testimonials.map((t) => {
    const attribution = [t.author, t.role].filter(Boolean).join(", ");
    return `> "${t.quote}"${attribution ? ` — ${attribution}` : ""}`;
  });
  return {
    key: "testimonials",
    title: "Testimonials",
    content: lines.join("\n\n"),
    source: "ai_extracted",
  };
}

function makeFaqsDoc(data: ScrapedWebsiteData): GeneratedSiteDoc | null {
  if (data.faqs.length === 0) return null;
  const lines = data.faqs.flatMap((f) => [`### ${f.question}`, "", f.answer, ""]);
  return {
    key: "faqs",
    title: "FAQs",
    content: lines.join("\n"),
    source: "ai_extracted",
  };
}

function makeSiteStructureDoc(data: ScrapedWebsiteData): GeneratedSiteDoc {
  const lines = [
    "# Site structure",
    "",
    `**Source URL**: ${data.url}`,
    "",
    "## Navigation",
    "",
    ...data.navLinks.map((link) => `- [${link.label}](${link.href})`),
  ];
  return {
    key: "site-structure",
    title: "Site structure",
    content: lines.join("\n"),
    source: "ai_extracted",
  };
}

export function generateSiteDocs(data: ScrapedWebsiteData): GeneratedSiteDoc[] {
  const brandInput = buildBrandGuidelinesInput(data);
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
    makeBusinessInfoDoc(data),
    makeSiteStructureDoc(data),
  ];

  const optionalDocs = [
    makeTeamDoc(data),
    makeTestimonialsDoc(data),
    makeFaqsDoc(data),
  ];

  for (const doc of optionalDocs) {
    if (doc) docs.push(doc);
  }

  return docs;
}

export async function saveSiteDocs(
  db: Kysely<DB>,
  workspaceUuid: string,
  docs: GeneratedSiteDoc[],
): Promise<void> {
  for (const doc of docs) {
    const existing = await db
      .selectFrom("docs")
      .select("uuid")
      .where("workspaceUuid", "=", workspaceUuid)
      .where("key", "=", doc.key)
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
        })
        .execute();
    }
  }
}
