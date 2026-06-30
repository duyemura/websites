import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import { callLlmAndLog } from "../llm-with-logging";
import type { Config } from "../../plugins/env";
import type { ScrapedWebsiteData } from "../../utils/scrape-docs";
import type { DB } from "../../types/db";

const PROMPT_PATH = path.resolve(__dirname, "./templates/business-info-extraction.md");

let cachedPrompt: string | null = null;

export function loadBusinessInfoExtractionTemplate(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, "utf8");
  return cachedPrompt;
}

const HoursEntrySchema = z.object({
  day: z.string(),
  hours: z.string(),
});

const BusinessInfoExtractionSchema = z.object({
  businessName: z.string(),
  tagline: z.string().nullable().optional(),
  oneLineSummary: z.string(),
  classification: z.object({
    industryNiche: z.string(),
    serviceModel: z.string(),
    primaryAudience: z.string(),
  }),
  location: z
    .object({
      address: z.string(),
      hours: z.array(HoursEntrySchema),
    })
    .nullable()
    .optional(),
  contact: z.object({
    phone: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    googleMapsUrl: z.string().nullable().optional(),
    socials: z.array(z.object({ platform: z.string(), url: z.string() })).default([]),
  }),
  offerings: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        intendedFor: z.string().nullable().optional(),
        priceFrequency: z.string().nullable().optional(),
      }),
    )
    .default([]),
  trustSignals: z
    .object({
      gmbRating: z.number().nullable().optional(),
      reviewCount: z.number().nullable().optional(),
      teamCredentials: z.array(z.string()).default([]),
    })
    .nullable()
    .optional(),
  testimonials: z
    .array(
      z.object({
        quote: z.string(),
        author: z.string().nullable().optional(),
        theme: z.string().default("other"),
      }),
    )
    .default([]),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  conversionSignals: z.object({
    primaryCta: z.string(),
    offer: z.string().nullable().optional(),
    signupMethod: z.string().nullable().optional(),
  }),
  messagingThemes: z.array(z.string()).default([]),
  competitiveAngle: z.string(),
});

export type BusinessInfoExtractionResult = z.infer<typeof BusinessInfoExtractionSchema>;

export interface BusinessInfoExtractionContext {
  db: Kysely<DB>;
  workspaceUuid: string;
  userUuid: string;
  siteUuid?: string;
}

function formatGmbHours(hours: { day: string; open?: string; close?: string; isClosed?: boolean }[]): string {
  const label = (day: string) => day.charAt(0) + day.slice(1).toLowerCase();
  return hours
    .map((h) => {
      if (h.isClosed || !h.open) return `${label(h.day)}: Closed`;
      return `${label(h.day)}: ${h.open}–${h.close ?? "—"}`;
    })
    .join("\n");
}

function cleanJsonResponse(content: string): string {
  return content
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

interface ParsedBusinessInfo {
  success: true;
  data: BusinessInfoExtractionResult;
}

interface FailedBusinessInfoParse {
  success: false;
  phase: "json-parse" | "schema-validation";
  errorMessage: string;
  cleanedContent: string;
}

type BusinessInfoParseResult = ParsedBusinessInfo | FailedBusinessInfoParse;

function parseBusinessInfoResponse(rawContent: string): BusinessInfoParseResult {
  const cleanedContent = cleanJsonResponse(rawContent);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedContent);
  } catch (err) {
    return {
      success: false,
      phase: "json-parse",
      errorMessage: err instanceof Error ? err.message : String(err),
      cleanedContent,
    };
  }

  const result = BusinessInfoExtractionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      phase: "schema-validation",
      errorMessage: result.error.message,
      cleanedContent,
    };
  }

  return { success: true, data: result.data };
}

function formatBusinessInfoParseError(rawContent: string, parse: FailedBusinessInfoParse): string {
  const phaseLabel = parse.phase === "json-parse" ? "JSON parse" : "schema validation";
  return [
    "Business info extraction response could not be used.",
    `Phase: ${phaseLabel}`,
    `Error: ${parse.errorMessage}`,
    "",
    "Cleaned response content:",
    "---",
    parse.cleanedContent,
    "---",
    "",
    "Raw response content:",
    "---",
    rawContent,
    "---",
  ].join("\n");
}

export function buildBusinessInfoInput(
  data: ScrapedWebsiteData,
  gmb?: GmbListing,
): string {
  const offerings = data.offerings
    .map((o) => `- ${o.name ?? "Unnamed offering"}${o.description ? `: ${o.description}` : ""}${o.price ? ` (${o.price})` : ""}`)
    .join("\n") || "None detected";

  const locations = data.locations
    .map((loc) => {
      const parts = [loc.name, loc.address, loc.hours].filter(Boolean);
      return `- ${parts.join(" — ")}`;
    })
    .join("\n") || "None detected";

  const testimonials = data.testimonials
    .map((t) => `- "${t.quote}"${t.author ? ` — ${t.author}` : ""}${t.role ? `, ${t.role}` : ""}`)
    .join("\n") || "None detected";

  const team = data.team
    .map((t) => `- ${t.name ?? "Unnamed"}${t.role ? ` (${t.role})` : ""}${t.bio ? `: ${t.bio}` : ""}`)
    .join("\n") || "None detected";

  const faqs = data.faqs.map((f) => `- Q: ${f.question}\n  A: ${f.answer}`).join("\n") || "None detected";

  const socials = data.contact?.social
    ?.map((s) => `- ${s.platform}: ${s.url}`)
    .join("\n") || "None detected";

  const gmbReviews = gmb?.reviews
    ?.map((r) => `- "${r.text ?? ""}"${r.author ? ` — ${r.author}` : ""}${r.rating ? ` (${r.rating}/5)` : ""}`)
    .join("\n") || "None detected";

  return JSON.stringify(
    {
      businessName: gmb?.name ?? data.businessName ?? data.title,
      tagline: gmb?.editorialSummary ?? data.tagline ?? "",
      description: data.description ?? "",
      headings: data.headings.slice(0, 20),
      paragraphs: data.paragraphs.slice(0, 10),
      offerings,
      locations,
      contact: {
        phone: gmb?.phoneNumber ?? data.contact?.phone ?? "",
        email: data.contact?.email ?? "",
        website: gmb?.websiteUri ?? data.url,
        socials,
      },
      team,
      testimonials,
      faqs,
      gmb: gmb
        ? {
            name: gmb.name,
            primaryType: gmb.primaryType,
            rating: gmb.rating,
            userRatingCount: gmb.userRatingCount,
            address: gmb.address,
            phoneNumber: gmb.phoneNumber,
            websiteUri: gmb.websiteUri,
            googleMapsUri: gmb.googleMapsUri,
            regularOpeningHours: gmb.regularOpeningHours?.length ? formatGmbHours(gmb.regularOpeningHours) : "",
            reviews: gmbReviews,
          }
        : null,
    },
    null,
    2,
  );
}

export async function extractBusinessInfoFields(
  data: ScrapedWebsiteData,
  gmb: GmbListing | undefined,
  config: Config,
  ctx?: BusinessInfoExtractionContext,
): Promise<BusinessInfoExtractionResult | null> {
  const template = loadBusinessInfoExtractionTemplate();

  if (!ctx) {
    return null;
  }

  const { response, outcome } = await callLlmAndLog(
    ctx,
    {
      agent: "memory-keeper",
      actionType: "memory_update",
      promptTemplateKeys: ["business-info-extraction"],
      summary: "Extract dense business info summary from scraped website corpus",
      messages: [
        { role: "system", content: template },
        { role: "user", content: buildBusinessInfoInput(data, gmb) },
      ],
      temperature: 0.5,
      maxTokens: 2500,
      jsonMode: true,
      postCall: (response) => {
        if (!response.content.trim()) {
          return undefined;
        }
        const parse = parseBusinessInfoResponse(response.content);
        if (!parse.success) {
          return {
            outcome: "partial",
            errorMessage: formatBusinessInfoParseError(response.content, parse),
            summary: "Failed to parse JSON from business info extraction response",
          };
        }
        return undefined;
      },
    },
    config,
  );

  if (outcome === "failure") {
    return null;
  }

  const parse = parseBusinessInfoResponse(response.content);
  return parse.success ? parse.data : null;
}
