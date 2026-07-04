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
  /** CSS animation names captured from the source site. LLM can use animate-{name}
   *  Tailwind class or style="animation:{name} 0.6s ease" to apply them. */
  animationNames?: string[];
  /** Re-hosted Lottie JSON URLs available for use in this section. When present,
   *  the LLM can place <lottie-player> elements using these URLs. */
  lottieUrls?: string[];
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

/**
 * Deterministic hero renderer — no LLM. Uses extracted DOM data directly.
 * The hero structure (background, overlay, eyebrow, heading, body, CTA) is
 * well-defined and doesn't need the LLM to invent it.
 */
export function renderHeroBlock(
  section: HierarchySection,
  evidence: SectionVisualEvidenceRow | undefined,
): string {
  const ds = evidence?.domStyles;
  const base = ds?.base ?? {};
  const lg = ds?.lg ?? {};

  // Prefer hierarchy heading; domStyles headingText is extracted directly from the section element
  // and is more reliable than page-level H1/H2 fallbacks that may pick up wrong sections.
  const heading = str(section.content.heading) || str(base.headingText) || str(ds?.md?.headingText) || str(lg.headingText);
  const eyebrow = str(section.content.eyebrow) || str(base.eyebrowText) || str(ds?.md?.eyebrowText) || str(lg.eyebrowText);
  const cta = section.content.cta;
  // Body: prefer hierarchy content, fall back to DOM-extracted body text.
  // Don't use bodyText if it matches the CTA label (extraction sometimes captures the button text).
  const ctaLabelStr = cta?.label ?? "";
  const rawBodyText = str(section.content.body) || str(base.bodyText) || str(ds?.md?.bodyText) || str(lg.bodyText);
  const body = rawBodyText && rawBodyText !== ctaLabelStr ? rawBodyText : "";

  // Background image: prefer domStyles (exact CSS url), fall back to first image
  const bgImageRaw = base.containerBackgroundImage ?? ds?.md?.containerBackgroundImage ?? lg.containerBackgroundImage ?? "";
  const bgImageUrl = bgImageRaw.match(/url\(["']?([^"')]+)["']?\)/)?.[1]
    ?? section.content.images?.[0]?.url ?? "";

  // Overlay — skip transparent values (rgba(0,0,0,0)); fall back to a moderate
  // dark overlay for any hero with a background image so white text is legible.
  const isNonTransparent = (v: string | undefined): v is string => !!v && !/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(v);
  const allOverlays = [base.overlayBackground, ds?.md?.overlayBackground, lg.overlayBackground].filter(isNonTransparent);
  const overlay = allOverlays[0] ?? (bgImageUrl ? "rgba(0,0,0,0.45)" : "");
  const overlayHtml = overlay
    ? `<div class="absolute inset-0" style="background:${overlay}"></div>`
    : "";

  // Content width — desktop constrains to extracted %, mobile is full width
  const lgWidth = lg.contentWidthPct ?? base.contentWidthPct;
  const widthClass = lgWidth ? `w-full lg:w-[${lgWidth}]` : "w-full lg:max-w-[55%]";

  // CTA alignment — right on desktop if domStyles say so, full-width on mobile
  const ctaSide = lg.ctaPositionSide ?? base.ctaPositionSide ?? "left";
  const ctaAlignClass = ctaSide === "right" ? "flex justify-end" : ctaSide === "center" ? "flex justify-center" : "";

  // Typography — mobile-first sizes from 3-tier extraction
  const fontSizeBase = base.headingFontSize ?? "1.75rem";
  const fontSizeMd = ds?.md?.headingFontSize;
  const fontSizeLg = lg.headingFontSize;
  const headingSizeClass = [
    `text-[${fontSizeBase}]`,
    fontSizeMd ? `md:text-[${fontSizeMd}]` : "",
    fontSizeLg ? `lg:text-[${fontSizeLg}]` : "",
  ].filter(Boolean).join(" ");

  const headingColor = base.headingColor ?? "rgb(255,255,255)";
  const headingFontWeight = base.headingFontWeight ?? "700";
  const rawTransform = base.headingTextTransform ?? ds?.md?.headingTextTransform ?? lg.headingTextTransform;
  const headingTextTransform = (rawTransform && rawTransform !== "none") ? `text-transform:${rawTransform};` : "";

  const eyebrowHtml = eyebrow
    ? `<p class="mb-3 text-sm font-semibold uppercase tracking-widest" style="color:${headingColor};opacity:0.7;">${eyebrow}</p>`
    : "";

  const ctaHtml = cta?.label
    ? `<div class="${ctaAlignClass} w-full mt-6">
        <a href="${cta.href ?? "#"}" class="inline-flex items-center justify-center rounded-[var(--radius)] bg-primary px-8 py-4 font-body text-base font-bold text-white hover:opacity-90 transition-opacity w-full lg:w-auto">
          ${cta.label}
        </a>
      </div>`
    : "";

  const bgStyle = bgImageUrl
    ? `background-image:url('${bgImageUrl}');background-size:cover;background-position:center;`
    : "";

  return `---
// Hero — deterministically rendered from DOM extraction
---
<section data-section-id="${section.id}" class="relative">
  <div class="relative" style="${bgStyle}min-height:600px;display:flex;align-items:center;">
    ${overlayHtml}
    <div class="relative z-10 w-full px-6 py-20 lg:px-16">
      <div class="${widthClass}">
        ${eyebrowHtml}
        ${heading ? `<h1 class="${headingSizeClass} font-heading font-[${headingFontWeight}] leading-tight" style="color:${headingColor};${headingTextTransform}">${heading}</h1>` : ""}
        ${body ? `<p class="mt-4 text-lg font-body" style="color:${headingColor};opacity:0.85;">${body}</p>` : ""}
        ${ctaHtml}
      </div>
    </div>
  </div>
</section>`;
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
  animationNames?: string[],
  lottieUrls?: string[],
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

  // DOM facts block: mobile-first Tailwind directives derived from 3-breakpoint capture.
  const ds = evidence?.domStyles;
  const animationLine = animationNames && animationNames.length > 0
    ? `- Available CSS animations (use animate-{name} Tailwind class or style="animation:{name} 0.6s ease"): ${animationNames.join(", ")}`
    : "";
  const lottieLines = lottieUrls && lottieUrls.length > 0
    ? lottieUrls
        .map((u) => `- Lottie animation available at: ${u} — use <lottie-player src="${u}" autoplay loop style="width:300px;height:300px"></lottie-player>`)
        .join("\n")
    : "";

  const domFactsLines: string[] = [];
  if (ds) {
    const { base, md, lg } = ds;

    // Helper: build a mobile-first Tailwind class string for a CSS-value property.
    // e.g. buildTwClass("text", "28px", "36px", "49px") → "text-[28px] md:text-[36px] lg:text-[49px]"
    const buildTwClass = (
      prefix: string,
      baseVal: string | undefined,
      mdVal: string | undefined,
      lgVal: string | undefined,
    ): string | null => {
      if (!baseVal && !mdVal && !lgVal) return null;
      const parts: string[] = [];
      if (baseVal) parts.push(`${prefix}-[${baseVal}]`);
      if (mdVal) parts.push(`md:${prefix}-[${mdVal}]`);
      if (lgVal) parts.push(`lg:${prefix}-[${lgVal}]`);
      return parts.join(" ") || null;
    };

    // Heading font-size
    const hSizeClass = buildTwClass("text", base.headingFontSize, md.headingFontSize, lg.headingFontSize);
    if (hSizeClass) domFactsLines.push(`- Heading size: ${hSizeClass}`);

    // Heading font-weight (usually stable across breakpoints)
    const hwBase = base.headingFontWeight ?? md.headingFontWeight ?? lg.headingFontWeight;
    if (hwBase) domFactsLines.push(`- Heading weight: font-[${hwBase}]`);

    // Heading color
    const hColorBase = base.headingColor;
    const hColorMd = md.headingColor;
    const hColorLg = lg.headingColor;
    if (hColorBase || hColorMd || hColorLg) {
      const colorVal = hColorBase ?? hColorMd ?? hColorLg ?? "";
      const isWhite = colorVal === "rgb(255, 255, 255)" || colorVal === "#fff" || colorVal === "#ffffff";
      const isBlack = colorVal === "rgb(0, 0, 0)" || colorVal === "#000" || colorVal === "#000000";
      const twColor = isWhite ? "text-white" : isBlack ? "text-black" : `text-[${colorVal}]`;
      domFactsLines.push(`- Heading color: ${twColor}${hColorBase !== hColorMd || hColorBase !== hColorLg ? " (base; md/lg may differ — use inline style if needed)" : ""}`);
    }

    // Heading text-transform
    const hTtBase = base.headingTextTransform ?? md.headingTextTransform ?? lg.headingTextTransform;
    if (hTtBase) domFactsLines.push(`- Heading text-transform: ${hTtBase} (use uppercase / normal-case Tailwind class)`);

    // CTA background
    const ctaBgBase = base.ctaBackground ?? md.ctaBackground ?? lg.ctaBackground;
    if (ctaBgBase) domFactsLines.push(`- CTA button background: ${ctaBgBase}`);

    // CTA color
    const ctaColorBase = base.ctaColor ?? md.ctaColor ?? lg.ctaColor;
    if (ctaColorBase) domFactsLines.push(`- CTA button text color: ${ctaColorBase}`);

    // CTA border-radius
    const ctaBrBase = base.ctaBorderRadius ?? md.ctaBorderRadius ?? lg.ctaBorderRadius;
    if (ctaBrBase) domFactsLines.push(`- CTA button border-radius: ${ctaBrBase}`);

    // CTA alignment — on mobile it's always center/full-width; desktop uses base/md/lg value
    const ctaSideBase = base.ctaPositionSide;
    const ctaSideLg = lg.ctaPositionSide ?? md.ctaPositionSide ?? ctaSideBase;
    if (ctaSideLg) {
      const lgAlign = ctaSideLg === "right" ? "self-end" : ctaSideLg === "left" ? "self-start" : "self-center";
      const baseAlign = ctaSideBase === "right" ? "self-end" : ctaSideBase === "left" ? "self-start" : "self-center";
      if (baseAlign === lgAlign) {
        domFactsLines.push(`- CTA alignment: ${baseAlign} (all breakpoints)`);
      } else {
        domFactsLines.push(`- CTA alignment: ${baseAlign} lg:${lgAlign}`);
      }
    }

    // Content width — mobile is always full-width; use lg (desktop) value
    const cwLg = lg.contentWidthPct ?? md.contentWidthPct;
    const cwBase = base.contentWidthPct;
    if (cwLg) {
      domFactsLines.push(`- Content width: w-full lg:w-[${cwLg}]`);
    } else if (cwBase) {
      domFactsLines.push(`- Content width: w-[${cwBase}] (mobile — apply md: prefix on wider)`);
    }

    // Section background
    const bgBase = base.containerBackground;
    const bgLg = lg.containerBackground ?? md.containerBackground;
    if (bgBase || bgLg) {
      const bgVal = bgBase ?? bgLg ?? "";
      const isTransparent = bgVal.includes("rgba(0, 0, 0, 0)") || bgVal === "transparent";
      if (!isTransparent) {
        const bgMdVal = md.containerBackground;
        if (bgMdVal && bgMdVal !== bgBase) {
          domFactsLines.push(`- Section background: bg-[${bgBase}] md:bg-[${bgMdVal}]${bgLg && bgLg !== bgMdVal ? ` lg:bg-[${bgLg}]` : ""}`);
        } else {
          domFactsLines.push(`- Section background: bg-[${bgBase ?? bgLg}]`);
        }
      }
    }

    // Background image
    const bgImgBase = base.containerBackgroundImage ?? md.containerBackgroundImage ?? lg.containerBackgroundImage;
    if (bgImgBase) domFactsLines.push(`- Background image: yes (set as CSS background-image)`);

    // Dark overlay
    const overlayBase = base.overlayBackground ?? md.overlayBackground ?? lg.overlayBackground;
    if (overlayBase) {
      // Convert rgba(0,0,0,0.5) → bg-black/50 when possible, else inline style
      const opacityMatch = overlayBase.match(/rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/);
      if (opacityMatch?.[1]) {
        const pct = Math.round(parseFloat(opacityMatch[1]) * 100);
        domFactsLines.push(`- Dark overlay: <div class="absolute inset-0 bg-black/${pct}"> (place inside section as first child, relative parent)`);
      } else {
        domFactsLines.push(`- Dark overlay: ${overlayBase} → place <div class="absolute inset-0" style="background:${overlayBase}"> as first child`);
      }
    }

    // Flex direction (only when not the default "row")
    const fdBase = base.flexDirection;
    const fdLg = lg.flexDirection ?? md.flexDirection;
    if (fdBase || fdLg) {
      const fdVal = fdBase ?? fdLg ?? "";
      if (fdVal && fdVal !== "row") {
        domFactsLines.push(`- Flex direction: flex-${fdVal.replace("-reverse", "")}${fdVal.includes("reverse") ? " flex-row-reverse" : ""}${fdLg && fdLg !== fdBase ? ` lg:flex-${fdLg}` : ""}`);
      }
    }

    // Padding
    const paddingBase = base.padding;
    const paddingLg = lg.padding ?? md.padding;
    if (paddingBase) {
      domFactsLines.push(`- Section padding: p-[${paddingBase}]${paddingLg && paddingLg !== paddingBase ? ` lg:p-[${paddingLg}]` : ""}`);
    }
  }

  if (animationLine) domFactsLines.push(animationLine);
  if (lottieLines) domFactsLines.push(lottieLines);

  const domFactsBlock = domFactsLines.length > 0
    ? `\n\nMobile-first responsive values (base = 375px, md: = 768px, lg: = 1440px). Use these EXACT Tailwind classes — do not guess from the screenshot:\n${domFactsLines.join("\n")}`
    : "";

  return `You are an expert Astro + Tailwind CSS frontend developer replicating an existing website section. Match the screenshot exactly for layout, spacing, imagery, and typography scale. Use the design tokens below for colors and fonts — they are computed directly from the live site via getComputedStyle and are authoritative.

Output ONLY the Astro component source code. Do not wrap it in markdown fences. The component must be valid Astro syntax and use Tailwind CSS utility classes.

The frontmatter (between the --- delimiters) is JavaScript — use // for comments, NEVER use # which is not valid JS syntax.

IMPORTANT CONSTRAINTS:
- Do NOT import any npm packages. The scaffold has no external dependencies beyond astro and tailwindcss. Any npm import will break the build.
- For icons: use inline SVG that semantically matches what the icon represents (calendar for scheduling, dumbbell for equipment, location pin for maps, etc.). Match the visual style shown — outline vs filled, stroke color, size. NEVER use a social media icon (Facebook, Instagram, phone, email) for non-social content like "Weekend Classes" or "Outdoor Fitness Area".
- If the page loaded an icon font (Font Awesome, etc.) it will be available — use fa-* class names where appropriate.
- For interactivity, use Alpine.js via CDN script tag or vanilla JS in a <script> tag — do not import it.
- The only valid imports in the frontmatter are shared section components (e.g. ../shared/MyComponent.astro). NEVER import Header.astro or Footer.astro — those are rendered by the Layout wrapper automatically and must not appear inside section components.

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
${nextTag ? `- Next section tag: ${nextTag} — content belonging to this next section (e.g. feature cards, program grids, testimonials) appears in the screenshot but must NOT be rendered here` : ""}
${section.tag === "hero" ? `- HERO SCOPE: render ONLY the hero background, eyebrow, heading, body text, and CTA button. Stop at the CTA. Any feature cards, program highlights, or content blocks visible below the CTA in the screenshot belong to separate sections and must be excluded from this component.` : ""}
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
    animationNames,
    lottieUrls,
    config,
  } = input;

  if (!evidence?.screenshotUrl) {
    return { code: renderFallbackBlock(section, designSystem), isFallback: true };
  }

  const model = modelForTask("vision", config);
  const prompt = buildVisualPrompt(
    section, designSystem, previousTag, nextTag,
    tailwindInstructions, evidence, extraInstructions, animationNames, lottieUrls,
  );
  const content: ChatContentPart[] = [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: evidence.screenshotUrl } },
  ];
  if (evidence.mobileScreenshotUrl) {
    content.push({ type: "text", text: "Mobile (375px) rendering of the same section:" });
    content.push({ type: "image_url", image_url: { url: evidence.mobileScreenshotUrl } });
  }

  // Retry up to 3 times — the LLM occasionally truncates its response.
  // Attempt 1 uses 8192 tokens; retries bump to 12000 to give more headroom.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await chatCompletion(
        { model, messages: [{ role: "user", content }], temperature: 0, maxTokens: attempt === 1 ? 8192 : 12000 },
        config,
      );

      let source = response.content.trim();
      if (!source) {
        console.warn(`[renderer] ${section.id} empty response (attempt ${attempt}/${MAX_ATTEMPTS})`);
        continue;
      }

      const fenceMatch = source.match(/```(?:astro)?\n([\s\S]*?)```/);
      if (fenceMatch?.[1]) {
        source = fenceMatch[1].trim();
      } else {
        source = source.replace(/^```(?:astro)?\n?/, "").trim();
      }

      const looksComplete = /[>}\]]$/.test(source.trimEnd());
      if (!looksComplete) {
        console.warn(`[renderer] ${section.id} truncated (attempt ${attempt}/${MAX_ATTEMPTS})`);
        continue;
      }

      return { code: sanitizeAstroFrontmatter(sanitizeSectionImports(source)), isFallback: false };
    } catch (err) {
      console.error(`[renderer] ${section.id} error attempt ${attempt}: ${(err as Error).message}`);
      if (attempt === MAX_ATTEMPTS) break;
    }
  }

  console.error(`[renderer] ${section.id} all ${MAX_ATTEMPTS} attempts failed — using fallback`);
  return { code: renderFallbackBlock(section, designSystem), isFallback: true };
}

/** Strip imports of Header.astro / Footer.astro from section components.
 *  Sections must not import shell components — the Layout wrapper renders them. */
function sanitizeSectionImports(source: string): string {
  return source.replace(
    /^import\s+\w+\s+from\s+['"][^'"]*(?:Header|Footer)\.astro['"]\s*;?\s*$/gm,
    "",
  );
}

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
