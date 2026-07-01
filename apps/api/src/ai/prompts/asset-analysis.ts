import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const PROMPT_PATH = path.resolve(__dirname, "./templates/asset-analysis.md");

let cachedPrompt: string | null = null;

export function loadAssetAnalysisTemplate(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, "utf8");
  return cachedPrompt;
}

export const AssetAnalysisSchema = z.object({
  description: z.string(),
  altText: z.string(),
  context: z.enum([
    "hero",
    "logo",
    "icon",
    "testimonial",
    "program",
    "class",
    "blog",
    "social",
    "background",
    "other",
  ]),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()).default([]),
  technical: z.object({
    hasText: z.boolean(),
    textConfidence: z.number().min(0).max(1).default(0),
    faces: z.number().int().nullable().optional(),
    people: z.number().int().nullable().optional(),
  }),
  quality: z.object({
    score: z.number().int().min(1).max(5),
    resolution: z.enum(["low", "medium", "high", "unknown"]),
    sharpness: z.enum(["blurry", "soft", "good", "sharp", "unknown"]),
    issues: z.array(z.string()).default([]),
  }),
  marketing: z.object({
    mood: z.string(),
    useCases: z.array(z.string()).default([]),
    subject: z.string(),
    brandFit: z.number().min(0).max(1).nullable().optional(),
  }),
  safety: z.object({
    hasIdentifiablePeople: z.boolean(),
    needsReview: z.boolean(),
  }),
});

export type AssetAnalysisResult = z.infer<typeof AssetAnalysisSchema>;

function cleanJsonResponse(content: string): string {
  return content
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

interface ParsedAssetAnalysis {
  success: true;
  data: AssetAnalysisResult;
}

interface FailedAssetAnalysisParse {
  success: false;
  phase: "json-parse" | "schema-validation";
  errorMessage: string;
  cleanedContent: string;
}

type AssetAnalysisParseResult = ParsedAssetAnalysis | FailedAssetAnalysisParse;

export function parseAssetAnalysisResponse(rawContent: string): AssetAnalysisParseResult {
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

  const result = AssetAnalysisSchema.safeParse(parsed);
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

export function formatAssetAnalysisParseError(
  rawContent: string,
  parse: FailedAssetAnalysisParse,
): string {
  const phaseLabel = parse.phase === "json-parse" ? "JSON parse" : "schema validation";
  return [
    "Asset analysis response could not be used.",
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
