import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import { IcpProfileSchema } from "@ploy-gyms/shared-types";
import { chatCompletion, sanitizeRawResponse } from "../llm-client";
import { modelForAgent } from "../model-picker";
import type { Config } from "../../plugins/env";
import type { ScrapedWebsiteData } from "../../utils/scrape-docs";
import type { DB } from "../../types/db";
import { logAiActivity } from "../../services/ai-activity";
import { getLlmPricing, calculateLlmCost, estimateLlmCostFromTotal } from "../../services/llm-pricing";

const PROMPT_PATH = path.resolve(__dirname, "./templates/workspace-memory-extraction.md");
const ICP_STANDARD_PATH = path.resolve(__dirname, "./templates/icp-standard.md");

let cachedPrompt: string | null = null;
let cachedIcpStandard: string | null = null;

export function loadWorkspaceMemoryExtractionTemplate(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, "utf8");
  return cachedPrompt;
}

export function loadIcpStandard(): string {
  if (cachedIcpStandard) return cachedIcpStandard;
  cachedIcpStandard = fs.readFileSync(ICP_STANDARD_PATH, "utf8");
  return cachedIcpStandard;
}

const WorkspaceMemoryExtractionSchema = z.object({
  industry: z.string().nullable().optional(),
  positioning: z.string().nullable().optional(),
  targetMembers: z.array(IcpProfileSchema).nullable().optional(),
  antiTargetMembers: z.array(IcpProfileSchema).nullable().optional(),
  differentiators: z.array(z.string()).nullable().optional(),
  brandVoice: z.string().nullable().optional(),
  businessPriorities: z.array(z.string()).nullable().optional(),
});

export type WorkspaceMemoryExtractionResult = z.infer<typeof WorkspaceMemoryExtractionSchema>;

export interface WorkspaceMemoryExtractionContext {
  db: Kysely<DB>;
  workspaceUuid: string;
  userUuid: string;
  siteUuid?: string;
}

export function buildCorpusInput(
  data: ScrapedWebsiteData,
  gmb?: GmbListing,
  heuristicIndustry?: string,
): string {
  const offerings = data.offerings
    .map((o) => `- ${o.name ?? "Unnamed offering"}${o.description ? `: ${o.description}` : ""}`)
    .join("\n") || "None detected";

  const testimonials = data.testimonials
    .map((t) => `- "${t.quote}"${t.author ? ` — ${t.author}` : ""}${t.role ? `, ${t.role}` : ""}`)
    .join("\n") || "None detected";

  const team = data.team
    .map((t) => `- ${t.name ?? "Unnamed"}${t.role ? ` (${t.role})` : ""}${t.bio ? `: ${t.bio}` : ""}`)
    .join("\n") || "None detected";

  const faqs = data.faqs.map((f) => `- Q: ${f.question}\n  A: ${f.answer}`).join("\n") || "None detected";

  const reviews = gmb?.reviews
    ?.map((r) => `- "${r.text ?? ""}"${r.author ? ` — ${r.author}` : ""}${r.rating ? ` (${r.rating}/5)` : ""}`)
    .join("\n") || "None detected";

  return JSON.stringify(
    {
      heuristicIndustry,
      businessName: data.businessName ?? data.title,
      tagline: data.tagline ?? "",
      description: data.description ?? "",
      headings: data.headings.slice(0, 20),
      paragraphs: data.paragraphs.slice(0, 10),
      offerings,
      testimonials,
      team,
      faqs,
      gmbCategory: gmb?.primaryType ?? "",
      gmbReviews: reviews,
    },
    null,
    2,
  );
}

export async function extractWorkspaceMemoryFields(
  data: ScrapedWebsiteData,
  gmb: GmbListing | undefined,
  heuristicIndustry: string | undefined,
  config: Config,
  ctx?: WorkspaceMemoryExtractionContext,
): Promise<WorkspaceMemoryExtractionResult | null> {
  const template = loadWorkspaceMemoryExtractionTemplate();
  const icpStandard = loadIcpStandard();

  const model = modelForAgent("memory-keeper", config);
  const provider = config.LLM_PROVIDER;
  const start = Date.now();
  let outcome: "success" | "partial" | "failure" = "failure";
  let errorMessage: string | null = null;
  let responseContent = "";
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  let totalTokens: number | null = null;
  let latencyMs: number | null = null;
  let rawResponse: Record<string, unknown> | null = null;

  try {
    const response = await chatCompletion(
      {
        model,
        messages: [
          { role: "system", content: `${template}\n\n## ICP Standard\n\n${icpStandard}` },
          { role: "user", content: buildCorpusInput(data, gmb, heuristicIndustry) },
        ],
        temperature: 0.5,
        maxTokens: 2500,
        jsonMode: true,
      },
      config,
    );

    responseContent = response.content;
    latencyMs = response.latencyMs ?? null;
    rawResponse = response.raw ?? null;
    promptTokens = response.usage?.promptTokens ?? null;
    completionTokens = response.usage?.completionTokens ?? null;
    totalTokens = response.usage?.totalTokens ?? null;

    const cleaned = responseContent
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const result = WorkspaceMemoryExtractionSchema.safeParse(parsed);
    if (!result.success) {
      outcome = "partial";
      errorMessage = `Parsed JSON did not match schema: ${result.error.message}`;
      return null;
    }
    outcome = "success";
    return result.data;
  } catch (err) {
    outcome = "failure";
    errorMessage = err instanceof Error ? err.message : String(err);
    return null;
  } finally {
    if (ctx) {
      await logWorkspaceMemoryExtraction(ctx, {
        provider,
        model,
        start,
        outcome,
        errorMessage,
        promptTokens,
        completionTokens,
        totalTokens,
        latencyMs,
        rawResponse,
      });
    }
  }
}

async function logWorkspaceMemoryExtraction(
  ctx: WorkspaceMemoryExtractionContext,
  params: {
    provider: string;
    model: string;
    start: number;
    outcome: "success" | "partial" | "failure";
    errorMessage: string | null;
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
    latencyMs: number | null;
    rawResponse: Record<string, unknown> | null;
  },
): Promise<void> {
  // Logging is best-effort; a failure here must never break extraction.
  try {
    const pricing = await getLlmPricing(ctx.db, params.provider, params.model);
    let costUsd: number | null = null;

    if (pricing) {
      if (params.promptTokens != null && params.completionTokens != null) {
        costUsd = calculateLlmCost(pricing, params.promptTokens, params.completionTokens);
      } else if (params.totalTokens != null) {
        costUsd = estimateLlmCostFromTotal(pricing, params.totalTokens);
      }
    }

    const sanitizedMetadata = sanitizeRawResponse(params.rawResponse ?? undefined);

    let summary: string;
    if (params.outcome === "success") {
      summary = "Extracted workspace memory fields from scraped website corpus";
    } else if (params.outcome === "partial") {
      summary = "LLM returned a response but it did not match the expected schema";
    } else {
      summary = "Failed to extract workspace memory fields from LLM response";
    }

    await logAiActivity(ctx.db, {
      workspaceUuid: ctx.workspaceUuid,
      userUuid: ctx.userUuid,
      siteUuid: ctx.siteUuid,
      actionType: "memory_update",
      model: params.model,
      provider: params.provider,
      promptTemplateKeys: ["workspace-memory-extraction", "icp-standard"],
      inputTokens: params.promptTokens,
      outputTokens: params.completionTokens,
      costUsd,
      latencyMs: params.latencyMs,
      outcome: params.outcome,
      summary,
      errorMessage: params.errorMessage,
      metadata: {
        totalTokens: params.totalTokens,
        responseMetadata: sanitizedMetadata,
        startedAt: new Date(params.start).toISOString(),
      },
    });
  } catch {
    // Swallow logging errors to keep extraction on the happy path.
  }
}
