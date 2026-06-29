import type { ScrapedBrandInput, ScrapedColor, ScrapedDesignToken } from "@ploy-gyms/shared-types";

function colorRoleName(role: ScrapedColor["role"]): string {
  const names: Record<ScrapedColor["role"], string> = {
    background: "Background",
    surface: "Surface",
    text: "Primary text",
    textMuted: "Secondary text",
    accent: "Accent",
    border: "Border",
    button: "Button fill",
    buttonText: "Button text",
  };
  return names[role];
}

function renderColorTable(colors: ScrapedBrandInput["colors"]): string {
  if (colors.length === 0) return "- No dominant colors detected.";
  const rows = colors
    .map(
      (c) =>
        `| ${colorRoleName(c.role)} | \`${c.token}\` | ${c.hex} | ${c.usage ?? ""} |`,
    )
    .join("\n");
  return `| Role | Token | Hex | Usage |
| --- | --- | --- | --- |
${rows}`;
}

function renderColorStrategy(input: ScrapedBrandInput): string {
  const lines: string[] = [];
  if (input.colorStrategy) lines.push(`- **Color Strategy**: ${input.colorStrategy}`);
  for (const rule of input.pairingRules ?? []) lines.push(`- **Pairing Rule**: ${rule}`);
  for (const rule of input.contextRules ?? []) lines.push(`- **Context Rule**: ${rule}`);
  if (input.darkModeBehavior) lines.push(`- **Dark Mode Behavior**: ${input.darkModeBehavior}`);
  if (lines.length === 0) {
    lines.push("- No detailed color strategy captured; derive from the color table above.");
  }
  return lines.join("\n");
}

function renderFontTable(fonts: ScrapedBrandInput["fonts"]): string {
  if (fonts.length === 0) return "- No fonts detected.";
  const rows = fonts
    .map(
      (f) =>
        `| ${f.role.charAt(0).toUpperCase() + f.role.slice(1)} | ${f.family} | ${f.weights?.join(", ") ?? "varies"} | ${f.usage ?? ""} |`,
    )
    .join("\n");
  return `| Role | Font | Weights | Usage |
| --- | --- | --- | --- |
${rows}`;
}

function renderTypeScale(scale: ScrapedBrandInput["typeScale"]): string {
  if (scale.length === 0) return "- No type scale detected.";
  const rows = scale
    .map(
      (s) =>
        `| ${s.element} | ${s.mobile ?? "—"} | ${s.tablet ?? "—"} | ${s.desktop ?? "—"} | ${s.notes ?? ""} |`,
    )
    .join("\n");
  return `| Element | Base / Mobile | md / Tablet | lg / Desktop | Notes |
| --- | --- | --- | --- | --- |
${rows}`;
}

function renderLayoutRules(rules: ScrapedBrandInput["layoutRules"], tokens?: ScrapedBrandInput["designTokens"]): string {
  const rows: string[] = [];
  for (const r of rules) {
    rows.push(`| ${r.element} | ${r.token ? `\`${r.token}\` | ` : ""}${r.value} |`);
  }
  for (const t of tokens ?? []) {
    if (t.token) {
      rows.push(`| ${tokenCategoryLabel(t.category)} | \`${t.token}\` = ${t.value}${t.usage ? ` (${t.usage})` : ""} |`);
    } else {
      rows.push(`| ${tokenCategoryLabel(t.category)} | ${t.value}${t.usage ? ` (${t.usage})` : ""} |`);
    }
  }
  if (rows.length === 0) return "- No layout or spacing rules detected.";
  const hasToken = rules.some((r) => r.token) || (tokens ?? []).some((t) => t.token);
  const header = hasToken
    ? "| Element | Token / Rule |\n| --- | --- |"
    : "| Element | Rule |\n| --- | --- |";
  return `${header}\n${rows.join("\n")}`;
}

function tokenCategoryLabel(category: ScrapedDesignToken["category"]): string {
  const labels: Record<ScrapedDesignToken["category"], string> = {
    spacing: "Spacing",
    radius: "Corner radius",
    borderWidth: "Border width",
    borderStyle: "Border style",
    shadow: "Shadow",
    grid: "Grid",
    maxWidth: "Max width",
    transition: "Transition",
    opacity: "Opacity",
  };
  return labels[category];
}

function renderTone(tone: ScrapedBrandInput): string {
  const keywords =
    tone.toneKeywords.length > 0
      ? tone.toneKeywords.join(", ")
      : "direct, inclusive, action-oriented";

  const allExamples = tone.toneExamples.slice(0, 12);
  const ctas = allExamples.filter((e) => e.length <= 35).slice(0, 6);
  const headlines = allExamples.filter((e) => e.length > 35).slice(0, 6);

  const renderExamples = (title: string, items: string[]) => {
    if (items.length === 0) return "";
    return `### ${title}\n\n${items.map((e) => `- "${e}"`).join("\n")}`;
  };

  return `## Tone keywords

- ${keywords}

## Copy examples

${renderExamples("Headlines", headlines)}

${renderExamples("Calls to action", ctas)}

${allExamples.length === 0 ? "- No example copy captured." : ""}`.trim();
}

function renderImagery(input: ScrapedBrandInput): string {
  const lines: string[] = [];
  if (input.imageryStrategy) lines.push(`- **Imagery Style**: ${input.imageryStrategy}`);
  if (input.imagePlacement && input.imagePlacement.length > 0) {
    lines.push("", "- **Placement Strategy**:");
    for (const placement of input.imagePlacement) {
      lines.push(`  - ${placement}`);
    }
  }
  if (input.promptKeywords && input.promptKeywords.length > 0) {
    lines.push("", `- **Prompt Keywords**: ${input.promptKeywords.join(", ")}.`);
  }
  if (input.images.length > 0 && !input.imageryStrategy) {
    const byContext: Record<string, string[]> = {};
    for (const img of input.images) {
      const list = byContext[img.context] ?? [];
      list.push(img.promptKeywords?.join(", ") ?? img.alt ?? "visual");
      byContext[img.context] = list;
    }
    for (const [context, keywords] of Object.entries(byContext)) {
      lines.push(`- **${context.charAt(0).toUpperCase() + context.slice(1)}**: ${keywords.slice(0, 3).join("; ")}`);
    }
  }
  if (lines.length === 0) lines.push("- No imagery detected.");
  return lines.join("\n");
}

function renderApplicationExamples(
  examples: string[],
  patterns: string[],
  screenshots: string[] = [],
): string {
  const parts: string[] = [];
  if (screenshots.length > 0) {
    parts.push(screenshots.map((url) => `![Asset ID: Original Website Screenshot](${url})`).join("\n\n"));
    parts.push("");
  }
  if (examples.length > 0) {
    parts.push(examples.map((e) => `- ${e}`).join("\n"));
  }
  if (patterns.length > 0) {
    if (examples.length > 0) parts.push("");
    parts.push("- **Detected components**:");
    for (const p of patterns) {
      parts.push(`  - ${p}`);
    }
  }
  if (examples.length === 0 && patterns.length === 0) {
    parts.push("- No application examples captured.");
  }
  return parts.join("\n");
}

export function generateBrandGuidelines(input: ScrapedBrandInput): string {
  return `# ${input.businessName} Brand Guidelines

## Brand Overview

- **Name**: ${input.businessName}
${input.tagline ? `- **Tagline**: ${input.tagline}` : ""}
${input.industry ? `- **Industry**: ${input.industry}` : ""}
${input.description ? `- **Description**: ${input.description}` : ""}
- **Source**: AI-extracted from reverse-engineered website.

## Color System

${renderColorStrategy(input)}

${renderColorTable(input.colors)}

${input.screenshotUrls?.length ? `![Asset ID: Original Website Screenshot](${input.screenshotUrls[0]})` : ""}

## Typography

${renderFontTable(input.fonts)}

## Font Sizes & Type Scale

${renderTypeScale(input.typeScale)}

## Tone of Voice

${renderTone(input)}

## Imagery

${renderImagery(input)}

## Layout & Spacing

${renderLayoutRules(input.layoutRules, input.designTokens)}

## Application Examples

${renderApplicationExamples(input.applicationExamples ?? [], input.componentPatterns, input.screenshotUrls)}
`;
}

export const BRAND_GUIDELINES_DOC_KEY = "brand-guidelines";
export const BRAND_GUIDELINES_DOC_TITLE = "Brand guidelines";
