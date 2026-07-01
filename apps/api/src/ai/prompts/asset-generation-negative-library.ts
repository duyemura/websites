import type { AssetGenerationUseCase } from "./asset-generation";

const GLOBAL_NEGATIVE_CONSTRAINTS = [
  "generic stock gym",
  "over-saturated colors",
  "plastic-looking equipment",
  "airbrushed skin",
  "perfect symmetry",
  "watermark",
  "readable text",
  "logos of other brands",
  "distorted anatomy",
  "extra limbs",
  "cloned equipment",
  "sterile white void",
];

const USE_CASE_NEGATIVE_CONSTRAINTS: Record<AssetGenerationUseCase, string[]> = {
  hero: [
    "busy foreground details that compete with headline overlay",
    "dominant faces looking at camera",
    "oversaturated filters",
  ],
  background: [
    "sharp foreground subject",
    "high-contrast busy details",
    "heavy shadows",
    "dominant faces",
  ],
  b_roll: [
    "static posed portrait",
    "studio backdrop",
    "perfectly still scene",
  ],
  social: [
    "tiny unreadable text",
    "multiple disconnected scenes",
    "oversaturated filters",
    "exaggerated physiques",
  ],
  program_page: [
    "unrelated equipment",
    "cluttered background",
    "dominant faces",
  ],
  blog_header: [
    "busy centre composition",
    "dominant faces looking at camera",
    "heavy vignette",
  ],
};

export function getNegativeConstraints(useCase: AssetGenerationUseCase): string[] {
  return [...GLOBAL_NEGATIVE_CONSTRAINTS, ...USE_CASE_NEGATIVE_CONSTRAINTS[useCase]];
}

export function formatNegativeConstraints(constraints: string[]): string {
  return constraints.join(", ");
}
