import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type {
  AssetGenerationUseCase,
  ReferenceAsset,
  VisualBrandMemory,
} from "../ai/prompts/asset-generation";
import type { AssetAnalysisResult } from "../ai/prompts/asset-analysis";
import { isAnalyzableImage } from "./asset-analysis";
import { readAssetConsent } from "./asset-consent";

export interface ReferenceSelectionInput {
  db: Kysely<DB>;
  workspaceUuid: string;
  useCase: AssetGenerationUseCase;
  userAssetUuids?: string[];
  brandMemory?: VisualBrandMemory;
  limit?: number;
}

export interface ReferenceSelectionResult {
  assets: ReferenceAsset[];
  warnings: string[];
}

const DEFAULT_LIMIT = 4;

interface Candidate {
  uuid: string;
  url: string;
  storageKey: string;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  analysis: AssetAnalysisResult;
  score: number;
}

function parseAssetMetadata(metadata: unknown): Record<string, unknown> {
  return (metadata ?? {}) as Record<string, unknown>;
}

function parseAnalysis(metadata: Record<string, unknown>): AssetAnalysisResult | null {
  const analysis = metadata.analysis;
  if (!analysis || typeof analysis !== "object") return null;
  return analysis as AssetAnalysisResult;
}

function parseDimensions(
  metadata: Record<string, unknown>,
): { width: number; height: number } | undefined {
  const dimensions = metadata.dimensions;
  if (
    dimensions &&
    typeof dimensions === "object" &&
    "width" in dimensions &&
    "height" in dimensions
  ) {
    const d = dimensions as { width?: number; height?: number };
    if (d.width && d.height) return { width: d.width, height: d.height };
  }
  return undefined;
}

function parseDominantColors(metadata: Record<string, unknown>): string[] {
  const technicalLocal = metadata.technicalLocal;
  if (technicalLocal && typeof technicalLocal === "object") {
    const colors = (technicalLocal as { dominantColors?: string[] }).dominantColors;
    if (Array.isArray(colors)) return colors;
  }
  return [];
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}

function colorDistance(a: string, b: string): number {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return 256;
  return Math.sqrt(
    Math.pow(rgbA.r - rgbB.r, 2) +
      Math.pow(rgbA.g - rgbB.g, 2) +
      Math.pow(rgbA.b - rgbB.b, 2),
  );
}

function brandColorScore(asset: Candidate, brandMemory?: VisualBrandMemory): number {
  if (!brandMemory?.colorPalette?.length) return 0;
  const colors = asset.metadata.technicalLocal
    ? ((asset.metadata.technicalLocal as { dominantColors?: string[] }).dominantColors ?? [])
    : [];
  if (colors.length === 0) return 0;
  let score = 0;
  for (const brand of brandMemory.colorPalette) {
    const min = Math.min(...colors.map((c) => colorDistance(c, brand.hex)));
    if (min < 60) score += 2;
    else if (min < 120) score += 1;
  }
  return score;
}

function useCaseMatchScore(asset: Candidate, useCase: AssetGenerationUseCase): number {
  const analysis = asset.analysis;
  if (analysis.context === useCase) return 1.0;
  if (analysis.marketing.useCases.includes(useCase)) return 0.8;
  const related = {
    hero: ["background"],
    background: ["hero"],
    b_roll: ["social", "program"],
    social: ["b_roll", "hero"],
    program_page: ["program", "class"],
    blog_header: ["background", "hero"],
  };
  const relatedTags = related[useCase];
  if (relatedTags?.some((tag) => analysis.context === tag || analysis.tags.includes(tag))) {
    return 0.5;
  }
  return 0;
}

function resolutionScore(asset: Candidate): number {
  const dims = parseDimensions(asset.metadata);
  if (!dims) return 0;
  if (dims.width >= 1920 || dims.height >= 1920) return 15;
  if (dims.width >= 1200 || dims.height >= 1200) return 10;
  if (dims.width >= 800 || dims.height >= 800) return 5;
  return 0;
}

function scoreCandidate(
  asset: Candidate,
  useCase: AssetGenerationUseCase,
  brandMemory?: VisualBrandMemory,
): Candidate {
  const quality = asset.analysis.quality.score ?? 3;
  const safetyPenalty = asset.analysis.safety.needsReview
    ? 15
    : asset.analysis.safety.hasIdentifiablePeople
      ? 10
      : 0;
  const score =
    useCaseMatchScore(asset, useCase) * 30 +
    (quality / 5) * 20 +
    resolutionScore(asset) +
    brandColorScore(asset, brandMemory) -
    safetyPenalty;
  return { ...asset, score };
}

function selectDiverse(
  ranked: Candidate[],
  limit: number,
  useCase: AssetGenerationUseCase,
): Candidate[] {
  const selected: Candidate[] = [];
  const usedSubjects = new Set<string>();
  const usedContexts = new Set<string>();

  const preferredContexts: Record<AssetGenerationUseCase, string[]> = {
    hero: ["hero", "background"],
    background: ["background", "hero"],
    b_roll: ["class", "social", "program"],
    social: ["social", "hero"],
    program_page: ["program", "class"],
    blog_header: ["hero", "background"],
  };

  // First pass: prefer one matching the target use case / preferred contexts.
  for (const ctx of [useCase, ...preferredContexts[useCase]]) {
    const match = ranked.find(
      (a) =>
        !selected.includes(a) && (a.analysis.context === ctx || a.analysis.tags.includes(ctx)),
    );
    if (match) {
      selected.push(match);
      usedSubjects.add(match.analysis.marketing.subject);
      usedContexts.add(match.analysis.context);
    }
  }

  // Second pass: fill remaining slots with highest scored assets while
  // avoiding duplicate subjects/contexts where possible.
  for (const asset of ranked) {
    if (selected.length >= limit) break;
    if (selected.includes(asset)) continue;
    if (
      usedSubjects.has(asset.analysis.marketing.subject) &&
      usedContexts.has(asset.analysis.context)
    ) {
      continue;
    }
    selected.push(asset);
    usedSubjects.add(asset.analysis.marketing.subject);
    usedContexts.add(asset.analysis.context);
  }

  // If diversity left us short, backfill by score.
  for (const asset of ranked) {
    if (selected.length >= limit) break;
    if (!selected.includes(asset)) selected.push(asset);
  }

  return selected.slice(0, limit);
}

export async function selectReferenceAssets(
  input: ReferenceSelectionInput,
): Promise<ReferenceSelectionResult> {
  const { db, workspaceUuid, useCase, userAssetUuids, brandMemory, limit = DEFAULT_LIMIT } = input;
  const warnings: string[] = [];

  const candidates = await db
    .selectFrom("assets")
    .selectAll()
    .where("workspaceUuid", "=", workspaceUuid)
    .where("source", "!=", "screenshot")
    .where((eb) =>
      eb.or([
        eb("type", "=", "image"),
        eb("mimeType", "like", "image/%"),
      ]),
    )
    .where("metadata", "@>", JSON.stringify({ analysis: {} }))
    .execute();

  if (userAssetUuids?.length) {
    const requested = candidates.filter((a) => userAssetUuids.includes(a.uuid));
    const missing = userAssetUuids.filter(
      (id) => !requested.some((a) => a.uuid === id),
    );
    if (missing.length > 0) {
      warnings.push(
        `${missing.length} requested reference asset(s) were not found or not image assets.`,
      );
    }
    const notAnalyzed = requested.filter(
      (a) => !parseAnalysis(parseAssetMetadata(a.metadata)),
    );
    if (notAnalyzed.length > 0) {
      warnings.push(
        `${notAnalyzed.length} requested reference asset(s) are not analyzed yet.`,
      );
    }
  }

  const scored: Candidate[] = candidates
    .map((asset) => {
      const metadata = parseAssetMetadata(asset.metadata);
      const analysis = parseAnalysis(metadata);
      if (!analysis) return null;
      if (!isAnalyzableImage(asset.type, asset.mimeType)) return null;
      return scoreCandidate(
        {
          uuid: asset.uuid,
          url: asset.url,
          storageKey: asset.storageKey,
          mimeType: asset.mimeType,
          metadata,
          analysis,
          score: 0,
        },
        useCase,
        brandMemory,
      );
    })
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { assets: [], warnings: [...warnings, "No analyzed image assets found in this workspace."] };
  }

  const lowQualityCount = scored.filter(
    (a) => a.analysis.quality.score < 3 || resolutionScore(a) < 5,
  ).length;
  if (lowQualityCount > 0 && lowQualityCount === scored.length) {
    warnings.push(
      "All available reference assets are low resolution or low quality; generated images may be less reliable.",
    );
  }

  const selected = selectDiverse(scored, limit, useCase);

  // Ensure user-requested assets are always included if they are valid.
  if (userAssetUuids?.length) {
    const requested = scored.filter((a) => userAssetUuids.includes(a.uuid));
    for (const asset of requested) {
      if (!selected.find((s) => s.uuid === asset.uuid)) {
        selected.push(asset);
      }
    }
  }

  const effectiveLimit = Math.min(Math.max(limit, userAssetUuids?.length ?? 0), 5);
  const final = selected.slice(0, effectiveLimit);

  const referenceAssets: ReferenceAsset[] = final.map((c) => ({
    uuid: c.uuid,
    url: c.url,
    storageKey: c.storageKey,
    analysis: c.analysis,
    dimensions: parseDimensions(c.metadata),
    dominantColors: parseDominantColors(c.metadata),
  }));

  // Safety: exclude assets with identifiable people unless consented.
  const consentFiltered = referenceAssets.filter((asset) => {
    const raw = scored.find((c) => c.uuid === asset.uuid);
    if (!raw) return true;
    const rawConsent = readAssetConsent({ uuid: asset.uuid, metadata: raw.metadata });
    if (rawConsent?.hasIdentifiablePeople && !rawConsent.hasConsentForAiGeneration) {
      warnings.push(
        `Reference asset ${asset.uuid} shows identifiable people without consent and was excluded.`,
      );
      return false;
    }
    return true;
  });

  if (consentFiltered.length === 0) {
    warnings.push(
      "No reference assets remain after removing images with unconsented identifiable people.",
    );
  }

  return { assets: consentFiltered, warnings };
}
