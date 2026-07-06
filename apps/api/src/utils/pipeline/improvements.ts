/**
 * Baseline-diff derived improvements. Pure functions — given a snapshot of the
 * source and clone, produce a list of "improvement receipts" the verify stage
 * can include on the VerifyArtifact.
 */

export interface QualitySnapshot {
  schemaTypes: string[];
  semanticElementCount: number;
  axeViolationCount: number;
  imageBytes: number;
  metaDescriptionPages: number;
  totalPages: number;
}

export interface Improvement {
  category: "semantics" | "performance" | "seo" | "accessibility" | "consistency";
  source: "baseline-diff";
  description: string;
  page?: string;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function deriveImprovements(
  baseline: QualitySnapshot,
  clone: QualitySnapshot,
): Improvement[] {
  const out: Improvement[] = [];

  // Schema (SEO): new schema types in clone that weren't in the baseline.
  const baselineSchemaSet = new Set(baseline.schemaTypes);
  const newSchemaTypes = clone.schemaTypes.filter(
    (t) => !baselineSchemaSet.has(t),
  );
  if (newSchemaTypes.length > 0) {
    const originalPart =
      baseline.schemaTypes.length === 0
        ? "original had none"
        : baseline.schemaTypes.join(", ");
    out.push({
      category: "seo",
      source: "baseline-diff",
      description: `Added structured data (${newSchemaTypes.join(", ")}) — ${originalPart}`,
    });
  }

  // Semantics: > 2x semantic elements.
  if (
    clone.semanticElementCount > baseline.semanticElementCount * 2 &&
    clone.semanticElementCount > baseline.semanticElementCount
  ) {
    out.push({
      category: "semantics",
      source: "baseline-diff",
      description: `Rebuilt with semantic HTML: ${clone.semanticElementCount} landmark/section elements vs ${baseline.semanticElementCount} in the original`,
    });
  }

  // Accessibility: fewer axe violations.
  if (clone.axeViolationCount < baseline.axeViolationCount) {
    const fixed = baseline.axeViolationCount - clone.axeViolationCount;
    out.push({
      category: "accessibility",
      source: "baseline-diff",
      description: `Fixed ${fixed} accessibility violations`,
    });
  }

  // Performance: image weight down > 20%.
  if (
    baseline.imageBytes > 0 &&
    clone.imageBytes < baseline.imageBytes * 0.8
  ) {
    const percent = Math.round(
      ((baseline.imageBytes - clone.imageBytes) / baseline.imageBytes) * 100,
    );
    out.push({
      category: "performance",
      source: "baseline-diff",
      description: `Reduced image weight ${percent}% (${formatBytes(baseline.imageBytes)} → ${formatBytes(clone.imageBytes)})`,
    });
  }

  // SEO: more meta description coverage.
  if (clone.metaDescriptionPages > baseline.metaDescriptionPages) {
    const added = clone.metaDescriptionPages - baseline.metaDescriptionPages;
    out.push({
      category: "seo",
      source: "baseline-diff",
      description: `Added missing meta descriptions to ${added} pages`,
    });
  }

  return out;
}
