import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import { IcpProfileSchema } from "@ploy-gyms/shared-types";
import { chatCompletion } from "../llm-client";
import { modelForAgent } from "../model-picker";
import type { Config } from "../../plugins/env";
import type { ScrapedWebsiteData } from "../../utils/scrape-docs";

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
});

export type WorkspaceMemoryExtractionResult = z.infer<typeof WorkspaceMemoryExtractionSchema>;

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
): Promise<WorkspaceMemoryExtractionResult | null> {
  const template = loadWorkspaceMemoryExtractionTemplate();
  const icpStandard = loadIcpStandard();

  try {
    const { content } = await chatCompletion(
      {
        model: modelForAgent("memory-keeper", config),
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

    const cleaned = content
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const result = WorkspaceMemoryExtractionSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}
