import type { ScrapedBrandInput, ScrapedColor } from "@ploy-gyms/shared-types";

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

function renderColorTable(colors: ScrapedColor[]): string {
  if (colors.length === 0) return "- No dominant colors detected.";
  const rows = colors
    .map(
      (c) =>
        `| ${colorRoleName(c.role)} | \`${c.token}\` | ${c.hex} | ${c.usage ?? ""} |`,
    )
    .join("\n");
  return `| Role | Token | Hex | Usage |\n| --- | --- | --- | --- |\n${rows}`;
}

function renderFontTable(fonts: ScrapedBrandInput["fonts"]): string {
  if (fonts.length === 0) return "- No fonts detected.";
  const rows = fonts
    .map(
      (f) =>
        `| ${f.role.charAt(0).toUpperCase() + f.role.slice(1)} | ${f.family} | ${f.weights?.join(", ") ?? "varies"} | ${f.usage ?? ""} |`,
    )
    .join("\n");
  return `| Role | Font | Weights | Usage |\n| --- | --- | --- | --- |\n${rows}`;
}

function renderTypeScale(scale: ScrapedBrandInput["typeScale"]): string {
  if (scale.length === 0) return "- No type scale detected.";
  const rows = scale
    .map(
      (s) =>
        `| ${s.element} | ${s.mobile ?? "—"} | ${s.tablet ?? "—"} | ${s.desktop ?? "—"} | ${s.notes ?? ""} |`,
    )
    .join("\n");
  return `| Element | Mobile | Tablet | Desktop | Notes |\n| --- | --- | --- | --- | --- |\n${rows}`;
}

function renderLayoutRules(rules: ScrapedBrandInput["layoutRules"]): string {
  if (rules.length === 0) return "- No layout rules detected.";
  const rows = rules
    .map(
      (r) =>
        `| ${r.element} | ${r.token ? `\`${r.token}\` | ` : ""}${r.value} |`,
    )
    .join("\n");
  const header = rules.some((r) => r.token)
    ? "| Element | Token | Rule |\n| --- | --- | --- |"
    : "| Element | Rule |\n| --- | --- |";
  return `${header}\n${rows}`;
}

function renderComponentPatterns(patterns: string[]): string {
  if (patterns.length === 0) return "- No specific component patterns detected.";
  return patterns.map((p) => `- ${p}`).join("\n");
}

function renderTone(tone: ScrapedBrandInput): string {
  const keywords =
    tone.toneKeywords.length > 0
      ? tone.toneKeywords.join(", ")
      : "direct, inclusive, action-oriented";
  const examples =
    tone.toneExamples.length > 0
      ? tone.toneExamples.map((e) => `- "${e}"`).join("\n")
      : "- No example copy captured.";
  return `**Keywords**: ${keywords}

**Examples**:
${examples}`;
}

function renderImagery(images: ScrapedBrandInput["images"]): string {
  if (images.length === 0) return "- No imagery detected.";
  const byContext: Record<string, string[]> = {};
  for (const img of images) {
    const list = byContext[img.context] ?? [];
    list.push(img.promptKeywords?.join(", ") ?? img.alt ?? "visual");
    byContext[img.context] = list;
  }
  return Object.entries(byContext)
    .map(
      ([context, keywords]) =>
        `- **${context.charAt(0).toUpperCase() + context.slice(1)}**: ${keywords.slice(0, 3).join("; ")}`,
    )
    .join("\n");
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

${renderColorTable(input.colors)}

## Typography

${renderFontTable(input.fonts)}

## Font Sizes & Type Scale

${renderTypeScale(input.typeScale)}

## Tone of Voice

${renderTone(input)}

## Imagery

${renderImagery(input.images)}

## Layout & Spacing

${renderLayoutRules(input.layoutRules)}

## Application Examples

${renderComponentPatterns(input.componentPatterns)}

${input.screenshotUrls?.length ? `\n## Reference Screenshots\n\n${input.screenshotUrls.map((url) => `![Original website screenshot](${url})`).join("\n\n")}` : ""}
`;
}

export const BRAND_GUIDELINES_DOC_KEY = "brand-guidelines";
export const BRAND_GUIDELINES_DOC_TITLE = "Brand guidelines";
