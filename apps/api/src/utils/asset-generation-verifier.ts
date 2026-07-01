import type {
  AssetGenerationUseCase,
  ReferenceAsset,
} from "../ai/prompts/asset-generation";
import type { AnalysisOutput } from "./asset-analysis";

export interface VerificationInput {
  generatedAnalysis: AnalysisOutput;
  referenceAssets: ReferenceAsset[];
  expectedUseCase: AssetGenerationUseCase;
  peoplePolicy?: import("../ai/prompts/asset-generation").PeopleHandling;
}

export interface VerificationResult {
  passed: boolean;
  fidelityScore: number;
  issues: string[];
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

function averageReferenceColor(
  referenceAssets: ReferenceAsset[],
): { r: number; g: number; b: number } | null {
  const colors: string[] = [];
  for (const asset of referenceAssets) {
    colors.push(...(asset.dominantColors ?? []));
  }
  if (colors.length === 0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (const hex of colors) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    r += rgb.r;
    g += rgb.g;
    b += rgb.b;
    count++;
  }
  if (count === 0) return null;
  return { r: r / count, g: g / count, b: b / count };
}

function generatedAverageColor(
  generatedDominantColors?: string[],
): { r: number; g: number; b: number } | null {
  return averageReferenceColor(
    generatedDominantColors?.map((hex) => ({
      uuid: "",
      url: "",
      storageKey: "",
      analysis: {} as unknown as ReferenceAsset["analysis"],
      dominantColors: [hex],
    })) ?? [],
  );
}

function checkColorPaletteDrift(
  issues: string[],
  input: VerificationInput,
): void {
  const refAvg = averageReferenceColor(input.referenceAssets);
  const genColors =
    (input.generatedAnalysis.technicalLocal?.dominantColors as string[] | undefined) ??
    [];
  const genAvg = generatedAverageColor(genColors);
  if (!refAvg || !genAvg) return;
  const distance = Math.sqrt(
    Math.pow(refAvg.r - genAvg.r, 2) +
      Math.pow(refAvg.g - genAvg.g, 2) +
      Math.pow(refAvg.b - genAvg.b, 2),
  );
  if (distance > 60) {
    issues.push("color palette drift");
  }
}

function checkContextDrift(
  issues: string[],
  input: VerificationInput,
): void {
  const { generatedAnalysis, expectedUseCase } = input;
  if (generatedAnalysis.context !== expectedUseCase) {
    if (
      !generatedAnalysis.marketing.useCases.includes(expectedUseCase) &&
      !generatedAnalysis.tags.includes(expectedUseCase)
    ) {
      issues.push("context mismatch");
    }
  }
}

function checkPeopleSafety(
  issues: string[],
  input: VerificationInput,
): void {
  if (!input.generatedAnalysis.safety.hasIdentifiablePeople) return;
  // consented_people is allowed; anonymous_only and no_people are not.
  if (input.peoplePolicy === "consented_people") return;
  // Default policy is no_people when not specified.
  issues.push("generated image contains identifiable people");
}

function checkQualityGate(
  issues: string[],
  input: VerificationInput,
): void {
  if (input.generatedAnalysis.quality.score < 3) {
    issues.push("generated image quality below threshold");
  }
}

function checkGenericLook(
  issues: string[],
  input: VerificationInput,
): void {
  const genericTerms = new Set([
    "gym",
    "fitness",
    "stock",
    "generic",
    "exercise",
  ]);
  const generatedTags = input.generatedAnalysis.tags.map((t) => t.toLowerCase());
  const genericCount = generatedTags.filter((t) => genericTerms.has(t)).length;
  const refSpecificTags = new Set<string>();
  for (const asset of input.referenceAssets) {
    for (const tag of asset.analysis.tags) {
      if (!genericTerms.has(tag.toLowerCase())) {
        refSpecificTags.add(tag.toLowerCase());
      }
    }
  }
  const specificMatches = generatedTags.filter((t) => refSpecificTags.has(t)).length;
  if (genericCount >= 2 && specificMatches < 2) {
    issues.push("generic fitness look");
  }
}

function checkUnexpectedText(
  issues: string[],
  input: VerificationInput,
): void {
  if (
    input.generatedAnalysis.technical.hasText &&
    input.generatedAnalysis.technical.textConfidence > 0.5
  ) {
    issues.push("unexpected text or logo in generated image");
  }
}

export function verifyGeneratedAsset(
  input: VerificationInput,
): VerificationResult {
  const issues: string[] = [];

  checkColorPaletteDrift(issues, input);
  checkContextDrift(issues, input);
  checkPeopleSafety(issues, input);
  checkQualityGate(issues, input);
  checkGenericLook(issues, input);
  checkUnexpectedText(issues, input);

  const penalty = Math.min(issues.length * 0.2, 1);
  const fidelityScore = 1 - penalty;
  const passed = fidelityScore >= 0.75 && !issues.includes("generated image contains identifiable people");

  return { passed, fidelityScore, issues };
}

