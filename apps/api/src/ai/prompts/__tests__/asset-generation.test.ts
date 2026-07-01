import { describe, test, expect } from "vitest";
import {
  buildImageGenerationPrompt,
  loadAssetGenerationTemplate,
} from "../asset-generation";
import type { AssetAnalysisResult } from "../asset-analysis";

function makeAnalysis(overrides?: Partial<AssetAnalysisResult>): AssetAnalysisResult {
  return {
    description: "A wide gym floor with barbells and rigs",
    altText: "CrossFit box interior",
    context: "hero",
    confidence: 0.9,
    tags: ["barbell", "rig", "warehouse", "rubber-mat"],
    technical: { hasText: false, textConfidence: 0, faces: null, people: 0 },
    quality: { score: 4, resolution: "high", sharpness: "good", issues: [] },
    marketing: { mood: "gritty", useCases: ["hero"], subject: "gym floor", brandFit: 0.8 },
    safety: { hasIdentifiablePeople: false, needsReview: false },
    ...overrides,
  };
}

const brandMemory = {
  businessName: "Test Gym",
  businessArchetype: "CrossFit box",
  mood: "gritty, energetic",
  colorPalette: [{ hex: "#111111" }, { hex: "#E31B23" }],
  promptKeywords: [],
  differentiators: [],
  equipmentTags: [],
};

describe("asset-generation prompt builder", () => {
  test("loads the markdown template", () => {
    const template = loadAssetGenerationTemplate();
    expect(template).toContain("{{USE_CASE}}");
    expect(template).toContain("{{SUBJECT}}");
  });

  test("builds a hero prompt with reference URLs", () => {
    const result = buildImageGenerationPrompt({
      useCase: "hero",
      subject: "empty gym floor before the morning class",
      referenceAssets: [
        {
          uuid: "00000000-0000-0000-0000-000000000001",
          url: "https://cdn.test/1.jpg",
          storageKey: "1.jpg",
          analysis: makeAnalysis(),
          dominantColors: ["#111111"],
        },
        {
          uuid: "00000000-0000-0000-0000-000000000002",
          url: "https://cdn.test/2.jpg",
          storageKey: "2.jpg",
          analysis: makeAnalysis({
            description: "Pull-up rig against exposed brick",
            tags: ["rig", "exposed-brick"],
          }),
          dominantColors: ["#E31B23"],
        },
      ],
      brandMemory,
      outputSpec: { aspectRatio: "16:9", style: "cinematic", peopleHandling: "anonymous_only" },
    });

    expect(result.prompt).toContain("https://cdn.test/1.jpg");
    expect(result.prompt).toContain("hero");
    expect(result.prompt).toContain("empty gym floor before the morning class");
    expect(result.prompt).toContain("CrossFit box");
    expect(result.prompt).toContain("gritty");
    expect(result.negativePrompt).toContain("generic stock gym");
    expect(result.referenceImageUrls).toHaveLength(2);
    expect(result.warnings).toContain(
      "Only 2 reference asset(s) available; results will be more generic with fewer references.",
    );
  });

  test("warns when reference assets contain identifiable people", () => {
    const result = buildImageGenerationPrompt({
      useCase: "hero",
      subject: "coaches leading a class",
      referenceAssets: [
        {
          uuid: "00000000-0000-0000-0000-000000000001",
          url: "https://cdn.test/people.jpg",
          storageKey: "people.jpg",
          analysis: makeAnalysis({
            safety: { hasIdentifiablePeople: true, needsReview: false },
          }),
        },
      ],
      brandMemory,
      outputSpec: { aspectRatio: "16:9", style: "photorealistic", peopleHandling: "consented_people" },
    });

    expect(result.safetyFlags).toContain(
      "1 reference asset(s) contain identifiable people; consent must be confirmed before publishing.",
    );
  });

  test("uses no_people policy text", () => {
    const result = buildImageGenerationPrompt({
      useCase: "background",
      subject: "serene practice room",
      referenceAssets: [
        {
          uuid: "00000000-0000-0000-0000-000000000001",
          url: "https://cdn.test/yoga.jpg",
          storageKey: "yoga.jpg",
          analysis: makeAnalysis({
            context: "background",
            tags: ["yoga-mat", "wood-floor"],
            marketing: { mood: "calm", useCases: ["background"], subject: "studio" },
          }),
        },
      ],
      brandMemory: { ...brandMemory, businessArchetype: "yoga studio" },
      outputSpec: { aspectRatio: "16:9", style: "photorealistic", peopleHandling: "no_people" },
    });

    expect(result.prompt).toContain("No people. No faces, hands, limbs, or silhouettes.");
  });
});
