import type { Config } from "../plugins/env";
import type { DesignSystemV2 } from "../types/design-system-v2";
import type { HierarchySection } from "../types/site-hierarchy";
import type { SectionVisualEvidenceRow } from "../types/section-visual-evidence";
import { modelForTask } from "../ai/model-picker";
import { chatCompletion, type ChatContentPart } from "../ai/llm-client";
import type { TailwindInstruction } from "../utils/pipeline/breakpoint-tailwind";

export interface RenderVisualBlockInput {
  section: HierarchySection;
  evidence?: SectionVisualEvidenceRow;
  designSystem: DesignSystemV2;
  /** Pre-computed responsive tailwind instructions from breakpoint deltas. */
  tailwindInstructions?: TailwindInstruction[];
  /** Optional extra prompt text appended to the base prompt (e.g. astro check
   *  errors on retry, or shared-component prop expectations). */
  extraInstructions?: string;
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

export function renderFallbackBlock(section: HierarchySection, designSystem: DesignSystemV2): string {
  // Never use the tag name as visible heading content — it's a technical label.
  const heading = str(section.content.heading) || "";
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

<section data-section-id="${section.id}" class="py-20 px-6 bg-[var(--color-background)] text-[var(--color-foreground)]">
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

function buildVisualPrompt(
  section: HierarchySection,
  designSystem: DesignSystemV2,
  previousTag?: string,
  nextTag?: string,
  tailwindInstructions?: TailwindInstruction[],
  evidence?: SectionVisualEvidenceRow,
  extraInstructions?: string,
): string {
  const tokens = designSystem.global.tokens;
  const rules = designSystem.global.rules;

  const instructions = tailwindInstructions ?? [];
  const responsiveBlock = instructions.length
    ? `\n\nResponsive behavior (REQUIRED — derived from the source site's actual breakpoints):\n${instructions
        .map((t) => `- ${t.selector}: ${t.instruction}`)
        .join("\n")}`
    : "";

  const captures = evidence?.interactionCaptures ?? [];
  const interactionBlock = captures.length
    ? `\n\nInteractive components in this section (implement with Alpine.js x-data/x-show + CSS transitions; use aria-expanded on the trigger element):\n${captures
        .map(
          (c) =>
            `- ${c.componentPattern ?? "toggle"} triggered by ${c.trigger}; observed style changes: ${JSON.stringify(c.styleDiff.slice(0, 5))}`,
        )
        .join("\n")}`
    : "";

  const extraBlock = extraInstructions ? `\n\n${extraInstructions}` : "";

  // DOM facts block: exact computed values from Playwright — no guessing needed
  const ds = evidence?.domStyles;
  const domFactsBlock = ds && Object.keys(ds).length > 0 ? `\n\nExact computed values from the live DOM (use these — do not guess from screenshot):
${ds.containerBackground ? `- Section background: ${ds.containerBackground}` : ""}
${ds.containerBackgroundImage ? `- Background image: yes (set as CSS background-image)` : ""}
${ds.overlayBackground ? `- Dark overlay: ${ds.overlayBackground} → place <div class="absolute inset-0"> with this exact rgba color` : ""}
${ds.headingFontSize ? `- Heading font-size: ${ds.headingFontSize}` : ""}
${ds.headingFontWeight ? `- Heading font-weight: ${ds.headingFontWeight}` : ""}
${ds.headingColor ? `- Heading color: ${ds.headingColor}` : ""}
${ds.headingTextTransform ? `- Heading text-transform: ${ds.headingTextTransform}` : ""}
${ds.ctaBackground ? `- CTA button background: ${ds.ctaBackground}` : ""}
${ds.ctaColor ? `- CTA button text color: ${ds.ctaColor}` : ""}
${ds.ctaBorderRadius ? `- CTA button border-radius: ${ds.ctaBorderRadius}` : ""}
${ds.ctaPositionSide ? `- CTA position: ${ds.ctaPositionSide} side of the section content` : ""}
${ds.flexDirection ? `- Flex direction: ${ds.flexDirection}` : ""}
${ds.padding ? `- Section padding: ${ds.padding}` : ""}`.replace(/\n+/g, "\n").trim() : "";

  return `You are an expert Astro + Tailwind CSS frontend developer replicating an existing website section. Match the screenshot exactly for layout, spacing, imagery, and typography scale. Use the design tokens below for colors and fonts — they are computed directly from the live site via getComputedStyle and are authoritative.

Output ONLY the Astro component source code. Do not wrap it in markdown fences. The component must be valid Astro syntax and use Tailwind CSS utility classes.

The frontmatter (between the --- delimiters) is JavaScript — use // for comments, NEVER use # which is not valid JS syntax.

IMPORTANT CONSTRAINTS:
- Do NOT import any npm packages. The scaffold has no external dependencies beyond astro and tailwindcss. Any npm import will break the build.
- For icons: use inline SVG that semantically matches what the icon represents (calendar for scheduling, dumbbell for equipment, location pin for maps, etc.). Match the visual style shown — outline vs filled, stroke color, size. NEVER use a social media icon (Facebook, Instagram, phone, email) for non-social content like "Weekend Classes" or "Outdoor Fitness Area".
- If the page loaded an icon font (Font Awesome, etc.) it will be available — use fa-* class names where appropriate.
- For interactivity, use Alpine.js via CDN script tag or vanilla JS in a <script> tag — do not import it.
- The only valid imports in the frontmatter are local .astro files (e.g. ../shared/Header.astro).

Authoritative design tokens (computed from the live DOM). These are available as named Tailwind utilities — use them directly:
- bg-primary / text-primary → ${tokens.colors.primary} (brand accent, CTAs, links)
- bg-background / text-foreground → page background and default text
- bg-muted / bg-muted-surface → subtle surface backgrounds
- text-muted-fg → secondary text
- font-heading → ${tokens.fonts.heading} (use for all headings)
- font-body → ${tokens.fonts.body} (use for body text)
- rounded-site → ${tokens.radius} border radius
- Max content width: ${rules?.maxWidth ?? "max-w-6xl"}

You can also use bg-[var(--color-*)] for any token not listed above.

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

CRITICAL: The outermost element of the component MUST include the attribute data-section-id="${section.id}" (literal string value hardcoded to this exact value, not a variable). This is required for automated quality checks.

Replicate EVERY visual detail visible in the screenshot:
- Background overlays: if the screenshot shows text over an image with a darkening layer, match the darkness/opacity you see — a layer that makes text readable is dark (use bg-black/[opacity]), not a brand color
- Layout arrangement: replicate the exact spatial arrangement from the screenshot — if content is left-aligned with a button on the right, use a horizontal flexbox; if stacked, use column. Never flip or rearrange
- CTA buttons: match the exact color, width, shape, icon, and position visible in the screenshot. If the screenshot shows the button on the right side of the hero, position it there
- URLs: ONLY use URLs from the provided Images and CTA metadata — do not construct or guess URLs from the screenshot. The screenshot is for visual reference only
- Section overlaps, card treatments, badge backgrounds: derive from the screenshot — match what you see, not what seems typical

Use CSS variables for brand colors (var(--color-*)) and load fonts from the heading/body font stack. Include frontmatter that declares any props or constants. Preserve all visible text.${responsiveBlock}${interactionBlock}${extraBlock}${domFactsBlock ? "\n\n" + domFactsBlock : ""}`;
}

export interface RenderVisualBlockResult {
  /** Rendered Astro component source. */
  code: string;
  /** True when the LLM path was skipped or failed and the deterministic
   *  fallback was returned instead. Callers that care about distinguishing a
   *  successful LLM render from a silent fallback (e.g. astro-check retry)
   *  can use this to log accurately. */
  isFallback: boolean;
}

/**
 * Same as {@link renderVisualBlock}, but returns a structured result that
 * flags whether the LLM call fell back to the deterministic block. This is
 * additive — existing callers can keep using `renderVisualBlock`; use this
 * variant only when the fallback distinction matters (retry logging, QA
 * accounting, etc.).
 */
export async function renderVisualBlockWithFlag(
  input: RenderVisualBlockInput,
): Promise<RenderVisualBlockResult> {
  const {
    section,
    evidence,
    designSystem,
    previousTag,
    nextTag,
    tailwindInstructions,
    extraInstructions,
    config,
  } = input;

  if (!evidence?.screenshotUrl) {
    return { code: renderFallbackBlock(section, designSystem), isFallback: true };
  }

  try {
    const model = modelForTask("vision", config);
    const prompt = buildVisualPrompt(
      section,
      designSystem,
      previousTag,
      nextTag,
      tailwindInstructions,
      evidence,
      extraInstructions,
    );

    const content: ChatContentPart[] = [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: evidence.screenshotUrl } },
    ];
    if (evidence.mobileScreenshotUrl) {
      content.push({ type: "text", text: "Mobile (375px) rendering of the same section:" });
      content.push({ type: "image_url", image_url: { url: evidence.mobileScreenshotUrl } });
    }

    const response = await chatCompletion(
      {
        model,
        messages: [{ role: "user", content }],
        temperature: 0,
        maxTokens: 8192,
      },
      config,
    );

    let source = response.content.trim();
    if (!source) {
      return { code: renderFallbackBlock(section, designSystem), isFallback: true };
    }

    // Extract code from a markdown fence anywhere in the response.
    // The LLM sometimes adds preamble text before the fence, or truncates before
    // the closing fence — handle both cases.
    const fenceMatch = source.match(/```(?:astro)?\n([\s\S]*?)```/);
    if (fenceMatch?.[1]) {
      source = fenceMatch[1].trim();
    } else {
      // No closing fence (truncated response) — strip just the opening fence.
      source = source.replace(/^```(?:astro)?\n?/, "").trim();
    }

    // Detect truncated output: valid Astro must end with a closing HTML tag or
    // closing brace. If it ends mid-token the LLM was cut off — use fallback.
    const trimmed = source.trimEnd();
    const looksComplete = /[>}\]]$/.test(trimmed);
    if (!looksComplete) {
      return { code: renderFallbackBlock(section, designSystem), isFallback: true };
    }

    return { code: sanitizeAstroFrontmatter(source), isFallback: false };
  } catch {
    return { code: renderFallbackBlock(section, designSystem), isFallback: true };
  }
}

/**
 * Convert any `# comment` lines inside the Astro frontmatter (the --- block)
 * to `// comment`. LLMs sometimes emit YAML-style hash comments in the JS
 * frontmatter which Vite/esbuild rejects with a syntax error.
 */
function sanitizeAstroFrontmatter(source: string): string {
  const FENCE = "---";
  const firstFence = source.indexOf(FENCE);
  if (firstFence === -1) return source;
  const afterFirst = firstFence + FENCE.length;
  const secondFence = source.indexOf(FENCE, afterFirst);
  if (secondFence === -1) return source;

  const before = source.slice(0, afterFirst);
  const frontmatter = source.slice(afterFirst, secondFence);
  const after = source.slice(secondFence);

  const sanitized = frontmatter.replace(/^([ \t]*)#(?!!) /gm, "$1// ");
  return before + sanitized + after;
}

export async function renderVisualBlock(input: RenderVisualBlockInput): Promise<string> {
  const result = await renderVisualBlockWithFlag(input);
  return result.code;
}
