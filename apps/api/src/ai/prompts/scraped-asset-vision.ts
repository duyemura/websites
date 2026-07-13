import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const PROMPT_PATH = path.resolve(__dirname, "./templates/scraped-asset-vision.md");

let cachedPrompt: string | null = null;

export function loadScrapedAssetVisionTemplate(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, "utf8");
  return cachedPrompt;
}

export const ScrapedAssetVisionSchema = z.object({
  description: z.string(),
  tags: z.array(z.string()).default([]),
  contexts: z.array(z.string()).default([]),
  subject: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ScrapedAssetVisionResult = z.infer<typeof ScrapedAssetVisionSchema>;

function cleanJsonResponse(content: string): string {
  return content
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export interface ParsedVisionTag {
  success: true;
  data: ScrapedAssetVisionResult;
}

export interface FailedVisionTag {
  success: false;
  errorMessage: string;
  cleanedContent: string;
}

export type VisionTagParseResult = ParsedVisionTag | FailedVisionTag;

export function parseScrapedAssetVisionResponse(rawContent: string): VisionTagParseResult {
  const cleanedContent = cleanJsonResponse(rawContent);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleanedContent);
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      cleanedContent,
    };
  }

  const result = ScrapedAssetVisionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      errorMessage: result.error.message,
      cleanedContent,
    };
  }

  return { success: true, data: result.data };
}
