import type { ComponentGroup } from "./section-grouper";
import { imageUrlToDataUri, type S3Context } from "./image-to-data-url";
import { stripForbiddenPackages } from "./astro-sanitize";

type ChatFn = (req: {
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  maxTokens?: number;
}) => Promise<string>;

export function buildAstroPromptText(group: ComponentGroup, siteCSS: string): string {
  const contract = group.exemplar.contract;
  const bgColor: string = (contract.layout as Record<string, unknown> | undefined)?.background
    ? ((contract.layout as Record<string, unknown>).background as Record<string, unknown>).color as string ?? ""
    : "";
  const headlineColor: string = (contract.typography as Record<string, unknown> | undefined)?.headline
    ? ((contract.typography as Record<string, unknown>).headline as Record<string, unknown>).color as string ?? ""
    : "";

  return `You are an expert Astro developer. Reproduce this website section as a production-ready Astro component.

SECTION: ${group.tag} / ${group.archetype}
COMPONENT NAME: ${group.name}

COMPUTED STYLES — these are the actual CSS property values measured from the live site:
${JSON.stringify(contract, null, 2)}

CRITICAL COLOR RULES:
- The section background-color is: "${bgColor || "inherit"}"
  → Use this EXACT value in CSS. Do NOT make it darker based on screenshots.
  → Many sections look visually dark in screenshots because they have a background IMAGE overlaid.
    The underlying background-color CSS property is still the value above.
  → If the section accepts a backgroundImageUrl prop, apply the image via inline style; without an
    image the section should show the background-color above.
- Use CSS custom properties for brand-dependent values so deployed sites apply their brand:
    colors: var(--color-primary), var(--color-secondary), var(--color-accent)
    fonts:  var(--font-heading), var(--font-body)
  Fall back to the computed values as the default: e.g. background-color: var(--color-primary, ${bgColor || "#f5f5f5"})
- CTA buttons should use var(--color-accent) for background color
- Heading text: ${headlineColor ? `"${headlineColor}" — use var(--color-primary, ${headlineColor}) or the appropriate variable` : "use var(--color-primary)"}

SITE CSS (font-face and custom properties — preserve these):
\`\`\`css
${siteCSS.slice(0, 6000)}
\`\`\`

REQUIREMENTS:
1. Complete .astro file starting with ---
2. TypeScript Props interface — every visible text, image, and link must be a typed prop (never hardcoded)
3. <style> block: use computed values from above, prefer CSS custom properties for colors/fonts
4. Mobile-first @media breakpoints for 375px base and 1440px desktop
5. Prop names should be semantic: headline, subheadline, ctaText, ctaHref, imageUrl, items[], etc.
6. Add \`data-eval-component="[ComponentName]"\` to the outermost HTML element. Use the actual component name from COMPONENT NAME above.
7. Reproduce the layout exactly as shown in the attached screenshots
8. NEVER use React/Preact hooks or JSX-style functions — Astro components are static frontmatter + template HTML only
9. NEVER import external packages — no astro-icon, @iconify, lucide-react, or any other package

Return ONLY the .astro file content, starting with ---. Do not wrap the code in markdown fences.`;
}

export async function generateAstroComponent(
  group: ComponentGroup,
  siteCSS: string,
  chatFn: ChatFn,
  s3Ctx?: S3Context,
): Promise<string> {
  const content: unknown[] = [{ type: "text", text: buildAstroPromptText(group, siteCSS) }];

  if (s3Ctx) {
    try {
      const desktopUri = await imageUrlToDataUri(group.exemplar.cropDesktop, s3Ctx);
      const mobileUri = await imageUrlToDataUri(group.exemplar.cropMobile, s3Ctx);

      const extractMedia = (uri: string): { mediaType: string; data: string } => {
        const match = uri.match(/^data:([^;]+);base64,(.+)$/);
        return { mediaType: match?.[1] ?? "image/png", data: match?.[2] ?? "" };
      };

      const desktop = extractMedia(desktopUri);
      const mobile = extractMedia(mobileUri);

      content.push(
        { type: "image", source: { type: "base64", media_type: desktop.mediaType, data: desktop.data } },
        { type: "text", text: "↑ Desktop (1440px). ↓ Mobile (375px)." },
        { type: "image", source: { type: "base64", media_type: mobile.mediaType, data: mobile.data } },
      );
    } catch (err) {
      console.warn("[astro-generator] S3 image load failed, generating without screenshots:", err);
    }
  }

  let response = await chatFn({ messages: [{ role: "user", content }], maxTokens: 6144 });
  let code = stripAstroFences(response.trim());

  // Basic guard: the output must be an Astro frontmatter + template file. If the
  // model returned React/Preact JSX or omitted the frontmatter fence, retry once
  // with an explicit correction prompt.
  if (!isValidAstroOutput(code)) {
    const correction = `That was not a valid Astro component. Astro components use frontmatter (---) and static HTML templates only — no React hooks, no JSX functions, no preact/imports. Return ONLY the corrected .astro file starting with ---.`;
    response = await chatFn({
      messages: [
        { role: "user", content },
        { role: "assistant", content: response },
        { role: "user", content: correction },
      ],
      maxTokens: 6144,
    });
    code = stripAstroFences(response.trim());
  }

  return validateAstroComponent(code, group.name);
}

export function validateAstroComponent(code: string, componentName: string): string {
  const warnings: string[] = [];

  // Must start with ---
  if (!code.startsWith("---")) {
    throw new Error(`[astro-generator] ${componentName}: generated code does not start with '---' (likely empty or error response)`);
  }

  // Must have closing --- for frontmatter
  const frontmatterEnd = code.indexOf("---", 3);
  if (frontmatterEnd === -1) {
    throw new Error(`[astro-generator] ${componentName}: frontmatter block never closed`);
  }

  // Check for <style> block balance — count { and } in the style block
  const styleMatch = code.match(/<style[^>]*>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    const css = styleMatch[1] ?? "";
    const opens = (css.match(/\{/g) ?? []).length;
    const closes = (css.match(/\}/g) ?? []).length;
    if (opens !== closes) {
      warnings.push(`CSS block mismatch: ${opens} '{' vs ${closes} '}' — may be truncated`);
    }
  } else if (code.includes("<style")) {
    // <style> opened but no </style>
    throw new Error(`[astro-generator] ${componentName}: <style> tag not closed — component was truncated`);
  }

  // Strip forbidden third-party imports, <script> blocks with bad imports, and
  // <Icon> usages. Stripping logic lives in the shared helper to avoid duplication
  // with astro-sanitize.ts (which is also called at scaffold time and in the eval loop).
  // Structural fixes (brace balancing, map-var defaults, eval-component injection) are
  // intentionally NOT applied here — validateAstroComponent owns structural validation.
  const cleaned = stripForbiddenPackages(code, componentName);

  if (warnings.length > 0) {
    console.warn(`[astro-generator] ${componentName}: ${warnings.join("; ")}`);
  }

  return cleaned;
}

function isValidAstroOutput(code: string): boolean {
  if (!code.startsWith("---")) return false;
  const closingFence = code.indexOf("---", 3);
  if (closingFence === -1) return false; // frontmatter never closed — truncated output
  const frontmatter = code.slice(3, closingFence);
  const afterFrontmatter = code.slice(closingFence + 3);
  // Reject React/Preact patterns.
  if (/\buseState\b/.test(afterFrontmatter)) return false;
  if (/Astro\.Component\b/.test(afterFrontmatter)) return false;
  if (/\bconst\s+\w+\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*return\s*\(/.test(afterFrontmatter)) return false;
  // Reject JSX in the frontmatter — LLM sometimes writes push(<svg key=...>) patterns.
  if (/\.push\s*\(\s*<[a-z]/.test(frontmatter)) return false;
  if (/key=\{/.test(frontmatter)) return false;
  return true;
}

/** Strip markdown code fences that some LLMs wrap around the .astro file. */
function stripAstroFences(raw: string): string {
  // Some models return fences with the language tag on a separate line or with
  // leading whitespace. Try the common patterns and fall back to a broader strip.
  const trimmed = raw.trim();
  if (trimmed.startsWith("---")) return trimmed;

  const fenced = trimmed
    .replace(/^```[a-z]*\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();

  return fenced.startsWith("---") ? fenced : trimmed;
}
