// apps/api/scripts/stages/docgen.ts
import {
  runDocgenStage,
} from "../../src/services/pipeline/docgen-stage";
import { saveSiteDocs } from "../../src/utils/site-docs";
import { saveArtifact, loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { chatCompletion } from "../../src/ai/llm-client";
import type { StageRunner, StageContext, StageResult } from "./types";
import type { ExtractArtifact } from "../../src/services/pipeline/extract-stage";

interface BusinessFields {
  businessName: string | null;
  tagline: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  hours: string | null;
  website: string | null;
}

async function extractBusinessWithLLM(
  text: string,
  headings: string[],
  siteUrl: string,
  ctx: StageContext,
): Promise<BusinessFields | null> {
  const prompt = `You are extracting business information from a gym website. The phone, address, and hours are often in the footer at the END of the page text. Return ONLY valid JSON with these fields (use null if not found):

{
  "businessName": "the gym's actual brand name",
  "tagline": "their tagline or motto if present",
  "phone": "phone number",
  "email": "email address",
  "address": "street address",
  "city": "city name",
  "state": "state abbreviation",
  "zip": "zip code",
  "hours": "hours summary",
  "website": "${siteUrl}"
}

Page headings: ${headings.slice(0, 20).join(" | ")}

Page text (look especially at footer/bottom for contact info):
${text.slice(0, 8000)}`;

  try {
    const response = await chatCompletion({
      model: ctx.config.DEFAULT_LLM_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }, ctx.config);

    const raw = response.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as BusinessFields;
  } catch (err) {
    ctx.log(`  [warn] LLM business extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export const docgenStage: StageRunner = {
  label: "docgen",
  requires: ["extract", "segment"],
  produces: "docgen",

  async run(ctx: StageContext): Promise<StageResult> {
    ctx.log(`  Model: ${ctx.config.DEFAULT_LLM_MODEL} (${ctx.config.LLM_PROVIDER})`);
    ctx.log(`  Running docgen...`);

    const docs = await runDocgenStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "replication",
      skipVision: true, // interaction classification unused for template path
    });

    await saveSiteDocs(ctx.db, ctx.workspaceUuid, docs, ctx.siteUuid);

    await saveArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "docgen" as any, {
      docCount: docs.length,
      docKeys: docs.map((d) => d.key),
    });

    // ── LLM business extraction ──────────────────────────────────────────────
    // Make a single LLM call to extract structured business info from the page.
    // Updates the business-info doc in DB with labeled fields the content mapper reads.
    ctx.log(`  Extracting business info via LLM...`);
    try {
      // Build text from site-hierarchy sections (more reliable than rawText for JS-rendered sites)
      const hierarchyDoc = docs.find(d => d.key === "site-hierarchy");
      const hierarchyJson = hierarchyDoc?.contentJson as any;
      const allSections = (hierarchyJson?.pages ?? []).flatMap((p: any) =>
        (p.sections ?? []).map((s: any) => [
          s.content?.heading, s.content?.body,
          ...(s.content?.items ?? []).map((i: any) => `${i.title ?? ""} ${i.description ?? ""}`),
        ].filter(Boolean).join(" "))
      );

      // Also pull navLinks from extract artifact for contact info
      const extractArtifact = await loadArtifact<ExtractArtifact>(
        ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "extract" as any,
      );
      const pages = extractArtifact?.payload?.pages ?? [];
      const allHeadings = pages.flatMap((p: any) => (p.content?.headings ?? []).map((h: any) => h.text));
      const navLinks = pages[0]?.content?.navLinks?.map((l: any) => l.label).join(", ") ?? "";

      const allText = allSections.join("\n");
      const homePage = pages[0];
      if (homePage || allText) {
        const site = await ctx.db.selectFrom("sites").select("sourceUrl").where("uuid", "=", ctx.siteUuid).executeTakeFirst();
        const biz = await extractBusinessWithLLM(allText, allHeadings, site?.sourceUrl ?? "", ctx);
        if (biz) {
          ctx.log(`  LLM extracted: ${JSON.stringify(biz)}`);
          // Build labeled markdown that the content mapper can read
          const labeled = [
            biz.businessName ? `**Business Name**: ${biz.businessName}` : null,
            biz.tagline ? `**Tagline**: ${biz.tagline}` : null,
            biz.phone ? `**Phone**: ${biz.phone}` : null,
            biz.email ? `**Email**: ${biz.email}` : null,
            biz.address ? `**Address**: ${biz.address}${biz.city ? `, ${biz.city}` : ""}${biz.state ? `, ${biz.state}` : ""}${biz.zip ? ` ${biz.zip}` : ""}` : null,
            biz.hours ? `**Hours**: ${biz.hours}` : null,
          ].filter(Boolean).join("\n");

          // Update the business-info doc in the DB
          await ctx.db.updateTable("docs")
            .set({ content: labeled, updatedAt: new Date() })
            .where("siteUuid", "=", ctx.siteUuid)
            .where("key", "=", "business-info")
            .where("status", "=", "active")
            .execute();
          ctx.log(`  Updated business-info doc with LLM data`);
        }
      }
    } catch (err) {
      ctx.log(`  [warn] Business LLM step failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    ctx.log(`  Saved ${docs.length} docs:`);
    for (const doc of docs) {
      const preview = (doc.content ?? "").replace(/\n/g, " ").slice(0, 80);
      ctx.log(`    [${doc.key}] ${preview}`);
    }

    return {
      stage: "docgen",
      status: "pass",
      durationMs: 0,
      metrics: {
        docs: docs.length,
        keys: docs.map((d) => d.key).join(", "),
      },
      warnings: [],
    };
  },
};
