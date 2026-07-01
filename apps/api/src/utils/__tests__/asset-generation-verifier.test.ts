import { describe, test, expect } from "vitest";
import { verifyGeneratedAsset } from "../asset-generation-verifier";
import type { AnalysisOutput } from "../asset-analysis";
import type { ReferenceAsset } from "../../ai/prompts/asset-generation";

function makeAnalysis(overrides?: Partial<AnalysisOutput>): AnalysisOutput {
  return {
    analyzedAt: new Date().toISOString(),
    model: "test",
    version: 1,
    description: "Generated gym interior",
    altText: "Gym interior",
    context: "hero",
    confidence: 0.9,
    tags: ["barbell", "rig", "warehouse"],
    technical: { hasText: false, textConfidence: 0, faces: null, people: 0 },
    quality: { score: 4, resolution: "high", sharpness: "good", issues: [] },
    marketing: { mood: "gritty", useCases: ["hero"], subject: "gym floor", brandFit: 0.8 },
    safety: { hasIdentifiablePeople: false, needsReview: false },
    technicalLocal: {
      format: "png",
      fileSize: 1000,
      dominantColors: ["#111111"],
    },
    ...overrides,
  };
}

function makeReference(overrides?: Partial<ReferenceAsset>): ReferenceAsset {
  return {
    uuid: "00000000-0000-0000-0000-000000000001",
    url: "https://cdn.test/ref.jpg",
    storageKey: "ref.jpg",
    analysis: {
      description: "Reference gym interior",
      altText: "Reference",
      context: "hero",
      confidence: 0.9,
      tags: ["barbell", "rig", "warehouse"],
      technical: { hasText: false, textConfidence: 0, faces: null, people: 0 },
      quality: { score: 4, resolution: "high", sharpness: "good", issues: [] },
      marketing: { mood: "gritty", useCases: ["hero"], subject: "gym floor", brandFit: 0.8 },
      safety: { hasIdentifiablePeople: false, needsReview: false },
    },
    dominantColors: ["#111111"],
    ...overrides,
  };
}

describe("asset generation verifier", () => {
  test("passes when generated asset matches references", () => {
    const result = verifyGeneratedAsset({
      generatedAnalysis: makeAnalysis(),
      referenceAssets: [makeReference()],
      expectedUseCase: "hero",
    });

    expect(result.passed).toBe(true);
    expect(result.fidelityScore).toBe(1);
    expect(result.issues).toHaveLength(0);
  });

  test("fails when generated image contains identifiable people under anonymous policy", () => {
    const result = verifyGeneratedAsset({
      generatedAnalysis: makeAnalysis({
        safety: { hasIdentifiablePeople: true, needsReview: true },
      }),
      referenceAssets: [makeReference()],
      expectedUseCase: "hero",
      peoplePolicy: "anonymous_only",
    });

    expect(result.passed).toBe(false);
    expect(result.issues).toContain("generated image contains identifiable people");
  });

  test("passes identifiable people under consented people policy", () => {
    const result = verifyGeneratedAsset({
      generatedAnalysis: makeAnalysis({
        safety: { hasIdentifiablePeople: true, needsReview: true },
      }),
      referenceAssets: [makeReference()],
      expectedUseCase: "hero",
      peoplePolicy: "consented_people",
    });

    expect(result.passed).toBe(true);
    expect(result.issues).not.toContain("generated image contains identifiable people");
  });

  test("flags color palette drift", () => {
    const result = verifyGeneratedAsset({
      generatedAnalysis: makeAnalysis({
        technicalLocal: { format: "png", fileSize: 1000, dominantColors: ["#00FF00"] },
      }),
      referenceAssets: [makeReference({ dominantColors: ["#FF0000"] })],
      expectedUseCase: "hero",
    });

    expect(result.issues).toContain("color palette drift");
  });

  test("flags generic fitness look", () => {
    const result = verifyGeneratedAsset({
      generatedAnalysis: makeAnalysis({
        tags: ["gym", "fitness", "stock"],
      }),
      referenceAssets: [makeReference()],
      expectedUseCase: "hero",
    });

    expect(result.issues).toContain("generic fitness look");
  });

  test("flags context mismatch", () => {
    const result = verifyGeneratedAsset({
      generatedAnalysis: makeAnalysis({
        context: "social",
        marketing: { mood: "gritty", useCases: [], subject: "social post", brandFit: 0.5 },
      }),
      referenceAssets: [makeReference()],
      expectedUseCase: "hero",
    });

    expect(result.issues).toContain("context mismatch");
  });
});
