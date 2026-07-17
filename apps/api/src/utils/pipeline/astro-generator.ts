import type { ComponentGroup } from "./section-grouper";
import { imageUrlToDataUri, type S3Context } from "./image-to-data-url";

type ChatFn = (req: {
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  maxTokens?: number;
}) => Promise<string>;

export function buildAstroPromptText(group: ComponentGroup, siteCSS: string): string {
  return `You are an expert Astro developer. Reproduce this website section as a production-ready Astro component.

SECTION: ${group.tag} / ${group.archetype}
COMPONENT NAME: ${group.name}

COMPUTED STYLES (use these exact values):
${JSON.stringify(group.exemplar.contract, null, 2)}

SITE CSS (font-face and custom properties — preserve these):
\`\`\`css
${siteCSS.slice(0, 6000)}
\`\`\`

REQUIREMENTS:
1. Complete .astro file starting with ---
2. TypeScript Props interface — every visible text, image, and link must be a typed prop (never hardcoded)
3. <style> block with scoped CSS using the exact computed values above
4. Mobile-first @media breakpoints for 375px base and 1440px desktop
5. Prop names should be semantic: headline, subheadline, ctaText, ctaHref, imageUrl, items[], etc.
6. Add \`data-eval-component="[ComponentName]"\` to the outermost HTML element (e.g. <section data-eval-component="HeroLeft"> or <div data-eval-component="CtaBand">). Use the actual component name from COMPONENT NAME above.
7. Reproduce the layout exactly as shown in the attached screenshots
8. NEVER use React/Preact hooks or JSX-style functions — Astro components are static frontmatter + template HTML only

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

  // Strip <script> blocks that import third-party packages not installed in the renderer.
  // Warn-and-continue is not enough — these break the build, so auto-remove the block.
  const FORBIDDEN_IMPORTS = ["astro-icon", "@iconify", "lucide-react", "react-icons"];
  let cleaned = code;
  cleaned = cleaned.replace(/<script[^>]*>([\s\S]*?)<\/script>/g, (fullMatch, scriptBody: string) => {
    const hasForbidden = FORBIDDEN_IMPORTS.some(
      (pkg) => scriptBody.includes(`"${pkg}"`) || scriptBody.includes(`'${pkg}'`),
    );
    if (hasForbidden) {
      console.warn(`[astro-generator] ${componentName}: removed <script> block with unresolvable import — it would break the renderer build`);
      return "";
    }
    return fullMatch;
  });

  // Also strip inline <Icon> JSX usages left behind after removing the import
  if (cleaned !== code) {
    cleaned = cleaned.replace(/<Icon\s[^/]*/g, "<!-- icon removed --> <span");
    cleaned = cleaned.replace(/\/>(\s*<!-- icon removed -->)/g, "></span>");
  }

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
