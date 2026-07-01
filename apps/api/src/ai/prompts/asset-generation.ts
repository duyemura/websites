import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AssetAnalysisSchema } from "./asset-analysis";
import {
  getNegativeConstraints,
  formatNegativeConstraints,
} from "./asset-generation-negative-library";

const PROMPT_PATH = path.resolve(__dirname, "./templates/asset-generation.md");

let cachedPrompt: string | null = null;

export function loadAssetGenerationTemplate(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = fs.readFileSync(PROMPT_PATH, "utf8");
  return cachedPrompt;
}

export const AssetGenerationUseCaseSchema = z.enum([
  "hero",
  "background",
  "b_roll",
  "social",
  "program_page",
  "blog_header",
]);

export type AssetGenerationUseCase = z.infer<typeof AssetGenerationUseCaseSchema>;

export const PeopleHandlingSchema = z.enum([
  "no_people",
  "anonymous_only",
  "consented_people",
]);

export type PeopleHandling = z.infer<typeof PeopleHandlingSchema>;

export const OutputSpecSchema = z.object({
  aspectRatio: z.enum(["16:9", "4:3", "1:1", "9:16", "21:9"]).default("16:9"),
  style: z
    .enum(["photorealistic", "cinematic", "lifestyle_illustration", "3d_render"])
    .default("photorealistic"),
  peopleHandling: PeopleHandlingSchema.default("anonymous_only"),
});

export type OutputSpec = z.infer<typeof OutputSpecSchema>;

export const BrandColorSchema = z.object({
  hex: z.string(),
  role: z.string().optional(),
});

export type BrandColor = z.infer<typeof BrandColorSchema>;

export const VisualBrandMemorySchema = z.object({
  businessName: z.string().optional(),
  businessArchetype: z.string(),
  mood: z.string(),
  brandVoiceHint: z.string().optional(),
  colorPalette: z.array(BrandColorSchema).min(1),
  imageryStrategy: z.string().optional(),
  promptKeywords: z.array(z.string()).default([]),
  differentiators: z.array(z.string()).default([]),
  lighting: z.string().optional(),
  interiorAndFinishes: z.string().optional(),
  equipmentTags: z.array(z.string()).default([]),
  signageNotes: z.string().optional(),
});

export type VisualBrandMemory = z.infer<typeof VisualBrandMemorySchema>;

export const ReferenceAssetSchema = z.object({
  uuid: z.string().uuid(),
  url: z.string().url(),
  storageKey: z.string(),
  analysis: AssetAnalysisSchema,
  dimensions: z
    .object({ width: z.number().int(), height: z.number().int() })
    .optional(),
  dominantColors: z.array(z.string()).optional(),
});

export type ReferenceAsset = z.infer<typeof ReferenceAssetSchema>;

export const AssetGenerationInputSchema = z.object({
  useCase: AssetGenerationUseCaseSchema,
  subject: z.string().min(1).max(600),
  referenceAssets: z.array(ReferenceAssetSchema).min(1).max(5),
  brandMemory: VisualBrandMemorySchema,
  outputSpec: OutputSpecSchema.default({}),
});

export type AssetGenerationInput = z.infer<typeof AssetGenerationInputSchema>;

export const ImageGenerationPromptSchema = z.object({
  prompt: z.string(),
  negativePrompt: z.string(),
  referenceImageUrls: z.array(z.string().url()),
  aspectRatio: z.string(),
  peoplePolicy: z.string(),
  warnings: z.array(z.string()),
  safetyFlags: z.array(z.string()),
});

export type ImageGenerationPrompt = z.infer<typeof ImageGenerationPromptSchema>;

const USE_CASE_DISPLAY_NAMES: Record<AssetGenerationUseCase, string> = {
  hero: "hero",
  background: "background",
  b_roll: "b-roll",
  social: "social",
  program_page: "program page",
  blog_header: "blog header",
};

const USE_CASE_FRAMING: Record<AssetGenerationUseCase, string> = {
  hero:
    "wide establishing shot, shallow depth of field, subject in the lower third, generous negative space in the upper half for a headline overlay",
  background:
    "soft focus, low detail, generous negative space, muted contrast, suitable for text overlay",
  b_roll:
    "candid medium shot, action in progress, dynamic angle, motion blur acceptable",
  social:
    "square or 4:5 composition, bold focal point, strong brand color presence, room for a caption",
  program_page:
    "medium shot focused on program-appropriate equipment or area, clean and readable",
  blog_header:
    "wide 16:9 or 21:9, atmospheric, not text-heavy, suitable for a header image",
};

const PEOPLE_POLICY_TEXT: Record<PeopleHandling, string> = {
  no_people:
    "No people. No faces, hands, limbs, or silhouettes. Empty space or equipment only.",
  anonymous_only:
    "Only anonymous athletes: show backs, blurred motion, out-of-focus figures, or limbs in action. No identifiable faces, eyes, tattoos, or unique clothing. Do not let anyone look at the camera.",
  consented_people:
    "Real people may appear only if they are clearly part of the scene and match the reference images. No invented faces, no mixed identities, no people who are not represented in the provided references.",
};

function displayUseCase(useCase: AssetGenerationUseCase): string {
  return USE_CASE_DISPLAY_NAMES[useCase];
}

function aggregateMood(referenceAssets: ReferenceAsset[], brandMemory: VisualBrandMemory): string {
  if (brandMemory.mood) return brandMemory.mood;
  const moods = referenceAssets
    .map((a) => a.analysis.marketing.mood)
    .filter((m): m is string => typeof m === "string" && m.length > 0);
  if (moods.length === 0) return "professional, motivating";
  const counts = new Map<string, number>();
  for (const mood of moods) {
    counts.set(mood, (counts.get(mood) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? moods[0]!;
}

function aggregateLighting(
  referenceAssets: ReferenceAsset[],
  brandMemory: VisualBrandMemory,
): string {
  if (brandMemory.lighting) return brandMemory.lighting;
  const descriptions = referenceAssets
    .map((a) => [a.analysis.description, a.analysis.altText, ...a.analysis.tags].join(" "))
    .join(" ");
  const lower = descriptions.toLowerCase();
  if (lower.includes("natural light")) return "soft natural light";
  if (lower.includes("dramatic")) return "dramatic contrast lighting";
  if (lower.includes("dark")) return "low-key moody lighting";
  if (lower.includes("fluorescent") || lower.includes("led")) return "bright even overhead lighting";
  if (lower.includes("warm")) return "warm tungsten lighting";
  return "professional fitness photography lighting";
}

function aggregateInteriorAndFinishes(
  referenceAssets: ReferenceAsset[],
  brandMemory: VisualBrandMemory,
): string {
  if (brandMemory.interiorAndFinishes) return brandMemory.interiorAndFinishes;
  const cues: string[] = [];
  for (const asset of referenceAssets) {
    const desc = asset.analysis.description.toLowerCase();
    if (desc.includes("warehouse")) cues.push("raw industrial warehouse space");
    if (desc.includes("wood")) cues.push("wood floors and warm natural finishes");
    if (desc.includes("white")) cues.push("clean bright walls");
    if (desc.includes("mirror")) cues.push("mirrored walls");
    if (desc.includes("exposed")) cues.push("exposed structural elements");
    if (desc.includes("rubber")) cues.push("rubber mat flooring");
    if (desc.includes("turf")) cues.push("turf training area");
  }
  if (cues.length === 0) {
    return `typical ${brandMemory.businessArchetype} interior`;
  }
  return [...new Set(cues)].join("; ");
}

function aggregateEquipment(referenceAssets: ReferenceAsset[], brandMemory: VisualBrandMemory): string {
  const explicit = brandMemory.equipmentTags ?? [];
  const fromAnalysis: string[] = [];
  const tagSet = new Set<string>();
  for (const asset of referenceAssets) {
    for (const tag of asset.analysis.tags) {
      const lower = tag.toLowerCase();
      if (
        [
          "barbell",
          "dumbbell",
          "kettlebell",
          "rig",
          "rack",
          "rower",
          "treadmill",
          "bike",
          "box",
          "mat",
          "plate",
          "bench",
          "cable",
          "medicine ball",
          "sandbag",
        ].some((kw) => lower.includes(kw))
      ) {
        tagSet.add(tag.toLowerCase());
      }
    }
  }
  for (const tag of tagSet) fromAnalysis.push(tag);
  const combined = [...new Set([...explicit, ...fromAnalysis])];
  if (combined.length === 0) {
    return `equipment commonly found in a ${brandMemory.businessArchetype}`;
  }
  return combined.slice(0, 6).join(", ");
}

function aggregateColorPalette(
  referenceAssets: ReferenceAsset[],
  brandMemory: VisualBrandMemory,
): string {
  const palette = [...brandMemory.colorPalette];
  for (const asset of referenceAssets) {
    for (const hex of asset.dominantColors ?? []) {
      if (!palette.some((c) => c.hex.toLowerCase() === hex.toLowerCase())) {
        palette.push({ hex });
      }
    }
  }
  const top = palette.slice(0, 5);
  if (top.length === 0) return "natural, neutral palette";
  return top.map((c) => (c.role ? `${c.role}: ${c.hex}` : c.hex)).join("; ");
}

function crowdDensityForUseCase(
  useCase: AssetGenerationUseCase,
  peopleHandling: PeopleHandling,
): string {
  if (peopleHandling === "no_people") return "empty space, no people";
  const base =
    useCase === "hero" || useCase === "background" || useCase === "blog_header"
      ? "sparse"
      : "sparse to moderate";
  if (peopleHandling === "anonymous_only") {
    return `${base}; anonymous athletes only, no faces or identifying features`;
  }
  return `${base}; consented people may appear in the background or mid-ground`;
}

function aggregateSpaceDetails(
  referenceAssets: ReferenceAsset[],
  brandMemory: VisualBrandMemory,
): string {
  const cues: string[] = [];
  for (const asset of referenceAssets) {
    const desc = asset.analysis.description.toLowerCase();
    if (desc.includes("signage")) cues.push("existing signage visible only if requested");
    if (desc.includes("garage")) cues.push("roll-up garage doors");
    if (desc.includes("window")) cues.push("large windows");
    if (desc.includes("brick")) cues.push("exposed brick");
    if (desc.includes("beam")) cues.push("exposed beams or steel");
    if (desc.includes("ceiling")) cues.push("industrial ceiling height");
  }
  if (brandMemory.signageNotes) cues.push(brandMemory.signageNotes);
  if (cues.length === 0) {
    return "minimal visible signage, no readable text unless part of the requested scene";
  }
  return [...new Set(cues)].join("; ");
}

function countIdentifiablePeopleReferences(referenceAssets: ReferenceAsset[]): number {
  return referenceAssets.filter((a) => a.analysis.safety.hasIdentifiablePeople).length;
}

function validateInput(input: AssetGenerationInput): {
  validated: AssetGenerationInput;
  warnings: string[];
  safetyFlags: string[];
} {
  const validated = AssetGenerationInputSchema.parse(input);
  const warnings: string[] = [];
  const safetyFlags: string[] = [];

  if (validated.referenceAssets.length < 3) {
    warnings.push(
      `Only ${validated.referenceAssets.length} reference asset(s) available; results will be more generic with fewer references.`,
    );
  }

  const identifiableCount = countIdentifiablePeopleReferences(validated.referenceAssets);
  if (identifiableCount > 0) {
    if (validated.outputSpec.peopleHandling === "no_people") {
      safetyFlags.push(
        `${identifiableCount} reference asset(s) contain identifiable people but output policy is no_people; using only for color/mood cues.`,
      );
    } else if (validated.outputSpec.peopleHandling === "anonymous_only") {
      safetyFlags.push(
        `${identifiableCount} reference asset(s) contain identifiable people; generation will avoid reproducing faces.`,
      );
    } else {
      safetyFlags.push(
        `${identifiableCount} reference asset(s) contain identifiable people; consent must be confirmed before publishing.`,
      );
    }
  }

  const interiorReferences = validated.referenceAssets.filter((a) =>
    ["hero", "background"].includes(a.analysis.context),
  );
  if (interiorReferences.length === 0) {
    warnings.push(
      "No clear interior or background reference found; the generated space will rely on the brand archetype description.",
    );
  }

  return { validated, warnings, safetyFlags };
}

function substitutePlaceholders(
  template: string,
  values: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

const MAX_PROMPT_LENGTH = 1500;

function trimPromptSafely(prompt: string): { prompt: string; trimmed: boolean } {
  if (prompt.length <= MAX_PROMPT_LENGTH) return { prompt, trimmed: false };
  // Trim from the bottom while preserving the core identity block.
  const sections = prompt.split("\n\n");
  let trimmed = false;
  while (prompt.length > MAX_PROMPT_LENGTH && sections.length > 3) {
    sections.pop();
    prompt = sections.join("\n\n");
    trimmed = true;
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    prompt = prompt.slice(0, MAX_PROMPT_LENGTH);
    trimmed = true;
  }
  return { prompt, trimmed };
}

export function buildImageGenerationPrompt(input: AssetGenerationInput): ImageGenerationPrompt {
  const { validated, warnings, safetyFlags } = validateInput(input);
  const { useCase, subject, referenceAssets, brandMemory, outputSpec } = validated;

  const referenceImageUrls = referenceAssets.map((a) => a.url);
  const referenceUrlBlock = referenceImageUrls.length
    ? referenceImageUrls.join("\n")
    : "";

  const negativeConstraints = getNegativeConstraints(useCase);
  const negativePrompt = formatNegativeConstraints(negativeConstraints);

  const values: Record<string, string> = {
    REFERENCE_IMAGE_URLS: referenceUrlBlock,
    STYLE: outputSpec.style,
    USE_CASE: displayUseCase(useCase),
    SUBJECT: subject,
    BUSINESS_ARCHETYPE: brandMemory.businessArchetype,
    MOOD: aggregateMood(referenceAssets, brandMemory),
    LIGHTING: aggregateLighting(referenceAssets, brandMemory),
    COLOR_PALETTE: aggregateColorPalette(referenceAssets, brandMemory),
    INTERIOR_AND_FINISHES: aggregateInteriorAndFinishes(referenceAssets, brandMemory),
    EQUIPMENT: aggregateEquipment(referenceAssets, brandMemory),
    CROWD_DENSITY: crowdDensityForUseCase(useCase, outputSpec.peopleHandling),
    SPACE_DETAILS: aggregateSpaceDetails(referenceAssets, brandMemory),
    USE_CASE_FRAMING: USE_CASE_FRAMING[useCase],
    PEOPLE_POLICY: PEOPLE_POLICY_TEXT[outputSpec.peopleHandling],
    NEGATIVE_CONSTRAINTS: negativePrompt,
  };

  const template = loadAssetGenerationTemplate();
  const prompt = substitutePlaceholders(template, values);
  const { prompt: trimmedPrompt, trimmed } = trimPromptSafely(prompt);
  if (trimmed) {
    warnings.push("Prompt exceeded safe length and was trimmed; some secondary details were removed.");
  }

  return {
    prompt: trimmedPrompt,
    negativePrompt,
    referenceImageUrls,
    aspectRatio: outputSpec.aspectRatio,
    peoplePolicy: outputSpec.peopleHandling,
    warnings,
    safetyFlags,
  };
}
