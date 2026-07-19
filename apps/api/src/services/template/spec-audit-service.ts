import fs from "node:fs";
import path from "node:path";
import type { ContractArtifact, SectionContract } from "../../types/section-contract";
import { getTemplateSpec, type TemplateSpec, type TemplateTheme } from "@milo/shared-types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SectionRow {
  /** Milo canonical section tag (e.g. "hero", "feature-grid", "testimonial-band") */
  tag: string;
  /** Layout archetype within the tag (e.g. "hero-center", "feature-grid-even") */
  archetype: string;
  /** Pages where this section type was detected */
  pages: string[];
  /** Number of occurrences across all pages */
  count: number;
}

export interface CoverageRow {
  tag: string;
  archetype: string;
  componentKey: string | null;       // key in spec.components, or null
  componentFile: string | null;      // relative .astro path, or null
  propsMapped: number;               // props with a source
  propsTotal: number;                // total props defined
  status: "covered" | "no-component" | "no-file" | "no-source";
}

export interface SpecAuditResult {
  templateName: string;
  detectedSections: SectionRow[];
  coverage: CoverageRow[];
  unusedComponents: string[];        // spec components not needed by any source section
  summary: {
    totalSectionTypes: number;
    covered: number;
    uncovered: number;
    scorePercent: number;
  };
}

// ─── Chrome sections never need a sections/ component ─────────────────────────
const CHROME_TAGS = new Set(["footer", "header", "nav", "unknown"]);

/**
 * Look up which component handles a given section type.
 *
 * Priority order:
 *  1. spec.sectionMapping["{tag}/{archetype}"] — human-maintained per-template
 *  2. spec.sectionMapping["{archetype}"]        — archetype-level fallback
 *  3. spec.sectionMapping["{tag}"]              — tag-level fallback
 *
 * Returns the component key (e.g. "Hero", "FAQ") or null when uncovered.
 * Uncovered sections are GAPS — they should be addressed via
 * `milo template add-component`, not by adding to a global hardcoded table.
 */
function resolveComponentFromSpec(
  tag: string,
  archetype: string,
  spec: TemplateSpec,
): string | null {
  const mapping = spec.sectionMapping ?? {};
  return (
    mapping[`${tag}/${archetype}`] ??
    mapping[archetype] ??
    mapping[tag] ??
    null
  );
}

// ─── Core service ─────────────────────────────────────────────────────────────

export interface SpecAuditInput {
  templateName: string;
  templateTheme: TemplateTheme;
  contract: ContractArtifact;
  repoRoot: string;
}

export function runSpecAudit(input: SpecAuditInput): SpecAuditResult {
  const { templateName, templateTheme, contract, repoRoot } = input;
  const spec = getTemplateSpec(templateTheme);
  const componentsDir = path.join(repoRoot, "apps/renderer/src/components/sections", templateName);

  // ── 1. Aggregate detected sections from the contract ──────────────────────
  const sectionMap = new Map<string, SectionRow>();

  for (const page of contract.pages) {
    for (const section of page.sections) {
      const key = `${section.tag}::${section.layout.archetype}`;
      const existing = sectionMap.get(key);
      if (existing) {
        existing.count++;
        if (!existing.pages.includes(page.path)) existing.pages.push(page.path);
      } else {
        sectionMap.set(key, {
          tag: section.tag,
          archetype: section.layout.archetype,
          pages: [page.path],
          count: 1,
        });
      }
    }
  }

  const detectedSections = [...sectionMap.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag) || a.archetype.localeCompare(b.archetype),
  );

  // ── 2. Build coverage rows ────────────────────────────────────────────────
  const specComponentKeys = spec ? Object.keys(spec.components) : [];
  const coveredComponentKeys = new Set<string>();

  const coverage: CoverageRow[] = detectedSections.map((section) => {
    // Skip chrome sections — they don't need coverage in the sections/ dir
    if (!spec || CHROME_TAGS.has(section.tag)) {
      return {
        tag: section.tag,
        archetype: section.archetype,
        componentKey: null,
        componentFile: null,
        propsMapped: 0,
        propsTotal: 0,
        status: "no-component" as const,
      };
    }

    // Look up which component handles this section using the spec's sectionMapping.
    // This is human-maintained per template — uncovered sections are real gaps.
    const matchedKey = resolveComponentFromSpec(section.tag, section.archetype, spec);

    if (!matchedKey) {
      return {
        tag: section.tag,
        archetype: section.archetype,
        componentKey: null,
        componentFile: null,
        propsMapped: 0,
        propsTotal: 0,
        status: "no-component" as const,
      };
    }

    coveredComponentKeys.add(matchedKey);

    const compSpec = spec.components[matchedKey]!;
    const componentName = compSpec.component ?? matchedKey;
    const filePath = path.join(componentsDir, `${componentName}.astro`);
    const fileExists = fs.existsSync(filePath);
    const relFile = fileExists
      ? `apps/renderer/src/components/sections/${templateName}/${componentName}.astro`
      : null;

    const props = Object.values(compSpec.props);
    const propsMapped = props.filter((p) => p.source).length;
    const propsTotal = props.length;

    let status: CoverageRow["status"] = "covered";
    if (!fileExists)         status = "no-file";
    else if (propsMapped === 0 && propsTotal > 0) status = "no-source";

    return {
      tag: section.tag,
      archetype: section.archetype,
      componentKey: matchedKey,
      componentFile: relFile,
      propsMapped,
      propsTotal,
      status,
    };
  });

  // ── 3. Find spec components NOT triggered by any detected section ─────────
  const unusedComponents = specComponentKeys.filter((k) => !coveredComponentKeys.has(k));

  // ── 4. Summary ────────────────────────────────────────────────────────────
  // Only count non-chrome sections in the score
  const scorable = coverage.filter((r) => r.tag !== "footer" && r.tag !== "header" && r.tag !== "nav" && r.tag !== "unknown");
  const covered = scorable.filter((r) => r.status === "covered").length;
  const totalSectionTypes = scorable.length;
  const scorePercent = totalSectionTypes === 0 ? 100 : Math.round((covered / totalSectionTypes) * 100);

  return {
    templateName,
    detectedSections,
    coverage,
    unusedComponents,
    summary: {
      totalSectionTypes,
      covered,
      uncovered: totalSectionTypes - covered,
      scorePercent,
    },
  };
}

// ─── Report writer ────────────────────────────────────────────────────────────

export function writeAuditReport(result: SpecAuditResult, repoRoot: string): string {
  const { summary } = result;
  const scoreIcon = summary.scorePercent >= 80 ? "✅" : summary.scorePercent >= 50 ? "⚠️" : "❌";

  const lines: string[] = [
    `# ${result.templateName} — spec audit`,
    ``,
    `${scoreIcon} **${summary.covered}/${summary.totalSectionTypes}** detected section types have components (${summary.scorePercent}%)`,
    ``,
    `## Section coverage`,
    ``,
    `| Tag | Archetype | Component | Props | File | Status |`,
    `|-----|-----------|-----------|-------|------|--------|`,
  ];

  for (const row of result.coverage) {
    const tag       = row.tag;
    const arch      = row.archetype;
    const comp      = row.componentKey ?? "—";
    const props     = row.propsTotal > 0 ? `${row.propsMapped}/${row.propsTotal}` : "—";
    const file      = row.componentFile ? `\`${path.basename(row.componentFile)}\`` : "—";
    const status    =
      row.tag === "unknown" ? "⏭  placeholder" :
      row.tag === "footer" || row.tag === "header" ? "⏭  chrome" :
      row.status === "covered"      ? "✅" :
      row.status === "no-component" ? "❌ no component" :
      row.status === "no-file"      ? "❌ file missing" :
      "⚠️  no prop sources";
    lines.push(`| \`${tag}\` | \`${arch}\` | ${comp} | ${props} | ${file} | ${status} |`);
  }

  if (result.unusedComponents.length > 0) {
    lines.push(``, `## Spec components not triggered by source sections`);
    lines.push(``, `These components are defined in the spec but no detected section maps to them:`);
    for (const k of result.unusedComponents) {
      lines.push(`- \`${k}\``);
    }
  }

  if (summary.uncovered > 0) {
    lines.push(``, `## What to do about uncovered sections`);
    lines.push(``, `For each ❌ row:`);
    lines.push(`1. Add a component entry to \`modernSpec.components\` with the section's tag`);
    lines.push(`2. Create \`apps/renderer/src/components/sections/${result.templateName}/{ComponentName}.astro\``);
    lines.push(`3. Add it to \`TAG_TO_COMPONENTS\` in \`spec-audit-service.ts\``);
    lines.push(`4. Re-run \`milo template --stages spec-audit\` to verify coverage`);
  } else {
    lines.push(``, `## All sections covered 🎉`);
    lines.push(`Every detected section type has a matching component with prop sources.`);
  }

  const reportDir = path.join(repoRoot, "docs/template-review");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${result.templateName}-spec-audit.md`);
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  return reportPath;
}
