import type { Config } from "../plugins/env";
import type { DesignSystemV2 } from "../types/design-system-v2";
import type { HierarchySection } from "../types/site-hierarchy";
import type { SectionVisualEvidenceRow } from "../types/section-visual-evidence";
import { modelForTask } from "../ai/model-picker";
import { chatCompletion } from "../ai/llm-client";

export interface RenderVisualBlockInput {
  section: HierarchySection;
  evidence?: SectionVisualEvidenceRow;
  designSystem: DesignSystemV2;
  previousTag?: string;
  nextTag?: string;
  config: Config;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderFallbackBlock(section: HierarchySection, designSystem: DesignSystemV2): string {
  const heading = escapeHtml(str(section.content.heading) || section.tag);
  const body = escapeHtml(str(section.content.body));
  const eyebrow = escapeHtml(str(section.content.eyebrow));
  const items = section.content.items ?? [];
  const images = section.content.images ?? [];
  const cta = section.content.cta;

  const headingStyle = designSystem.brand.headingStyle;
  const headingClass = [
    "text-3xl tracking-tight font-[family-name:var(--font-heading)]",
    headingStyle?.uppercase ? "uppercase" : "",
    headingStyle?.bold ? "font-black" : "font-bold",
  ]
    .filter(Boolean)
    .join(" ");

  const eyebrowBlock = eyebrow
    ? `<p class="mb-4 inline-block text-sm font-semibold uppercase tracking-widest text-[var(--color-primary)] font-[family-name:var(--font-body)]">${eyebrow}</p>`
    : "";

  const bodyBlock = body
    ? `<p class="mt-6 text-lg whitespace-pre-line font-[family-name:var(--font-body)] text-[var(--color-muted-foreground)]">${body}</p>`
    : "";

  const imageBlock = images
    .slice(0, 1)
    .map(
      (img) =>
        `<img src=${JSON.stringify(img.url)} alt=${JSON.stringify(img.alt ?? heading)} class="w-full rounded-[var(--radius)] object-cover max-h-[28rem]" loading="lazy" />`,
    )
    .join("");

  const itemsBlock =
    items.length > 0
      ? `<div class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">${items
          .map(
            (item) =>
              `<div class="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] p-6">${item.title ? `<h3 class="text-xl font-bold font-[family-name:var(--font-heading)] text-[var(--color-foreground)]">${escapeHtml(item.title)}</h3>` : ""}${item.description ? `<p class="mt-2 text-[var(--color-muted-foreground)] font-[family-name:var(--font-body)]">${escapeHtml(item.description)}</p>` : ""}</div>`,
          )
          .join("")}</div>`
      : "";

  const ctaBlock =
    cta?.label && cta?.href
      ? `<a href=${JSON.stringify(cta.href)} class="mt-8 inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--color-primary)] px-8 py-4 text-base font-bold uppercase tracking-wide text-[var(--color-primary-foreground)] hover:opacity-90">${escapeHtml(cta.label)}</a>`
      : "";

  return `---
const tag = ${json(section.tag)};
const heading = ${json(heading)};
const body = ${json(body)};
const eyebrow = ${json(eyebrow)};
const items = ${json(items)};
const images = ${json(images)};
const cta = ${json(cta)};
---

<section class="py-20 px-6 bg-[var(--color-background)] text-[var(--color-foreground)]">
  <div class="max-w-6xl mx-auto">
    <div class="${imageBlock ? "grid gap-10 items-center lg:grid-cols-[1fr_1.25fr]" : ""}">
      ${imageBlock}
      <div class="${imageBlock ? "order-2" : ""}">
        ${eyebrowBlock}
        {heading && <h2 class="${headingClass}">{heading}</h2>}
        ${bodyBlock}
        ${ctaBlock}
      </div>
    </div>
    ${itemsBlock}
  </div>
</section>`;
}

function buildVisualPrompt(section: HierarchySection, designSystem: DesignSystemV2, previousTag?: string, nextTag?: string): string {
  const tokens = designSystem.global.tokens;
  const rules = designSystem.global.rules;

  return `You are an expert Astro + Tailwind CSS frontend developer. Replicate the visual design of the attached reference screenshot as a single self-contained Astro component.

Output ONLY the Astro component source code. Do not wrap it in markdown fences. The component must be valid Astro syntax and use Tailwind CSS utility classes.

Use these locked design tokens and rules from the site's design system:
- Primary color: ${tokens.colors.primary}
- Primary foreground: ${tokens.colors.primaryForeground}
- Background: ${tokens.colors.background}
- Foreground: ${tokens.colors.foreground}
- Muted surface: ${tokens.colors.muted}
- Muted foreground: ${tokens.colors.mutedForeground}
- Border: ${tokens.colors.border}
- Heading font: ${tokens.fonts.heading}
- Body font: ${tokens.fonts.body}
- Radius: ${tokens.radius}
- Spacing guidance: ${rules?.spacing ?? "Use generous vertical padding (py-20) and max-w-6xl containers"}
- Max width: ${rules?.maxWidth ?? "max-w-6xl"}
- Default theme: ${rules?.defaultTheme ?? "light"}

Section metadata:
- Tag: ${section.tag}
- Intent: ${section.intent}
- Section ID: ${section.id}
${section.content.heading ? `- Heading: ${section.content.heading}` : ""}
${section.content.eyebrow ? `- Eyebrow: ${section.content.eyebrow}` : ""}
${section.content.body ? `- Body: ${section.content.body}` : ""}
${section.content.items?.length ? `- Items: ${JSON.stringify(section.content.items)}` : ""}
${section.content.images?.length ? `- Images: ${JSON.stringify(section.content.images)}` : ""}
${section.content.cta ? `- CTA: ${JSON.stringify(section.content.cta)}` : ""}
${previousTag ? `- Previous section tag: ${previousTag}` : ""}
${nextTag ? `- Next section tag: ${nextTag}` : ""}
${section.notes ? `- Notes: ${section.notes}` : ""}

The component should match the screenshot's layout, typography, spacing, colors, and imagery as closely as possible while remaining fully responsive. Use CSS variables for colors via var(--color-*) references. Include frontmatter that declares any props/constants used. Preserve all visible text content from the screenshot and metadata. If the screenshot shows a grid, cards, columns, or a specific background treatment, replicate it. Avoid arbitrary inline styles unless necessary for a precise match.`;
}

export async function renderVisualBlock(input: RenderVisualBlockInput): Promise<string> {
  const { section, evidence, designSystem, previousTag, nextTag, config } = input;

  if (!evidence?.screenshotUrl) {
    return renderFallbackBlock(section, designSystem);
  }

  const model = modelForTask("vision", config);
  const prompt = buildVisualPrompt(section, designSystem, previousTag, nextTag);

  const response = await chatCompletion(
    {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: evidence.screenshotUrl } },
          ],
        },
      ],
      temperature: 0.2,
      maxTokens: 4096,
    },
    config,
  );

  let source = response.content.trim();
  // Strip markdown fences if the model wrapped the Astro source in them.
  if (source.startsWith("```astro") && source.endsWith("```")) {
    source = source.slice(7, -3).trim();
  } else if (source.startsWith("```") && source.endsWith("```")) {
    source = source.slice(3, -3).trim();
  }

  return source;
}
