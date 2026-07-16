import type { ComponentGroup } from "./section-grouper";
import { imageUrlToDataUri, type S3Context } from "./image-to-data-url";

type ChatFn = (req: {
  messages: Array<{ role: "user"; content: unknown }>;
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
6. Reproduce the layout exactly as shown in the attached screenshots

Return ONLY the .astro file content, starting with ---.`;
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

  const response = await chatFn({ messages: [{ role: "user", content }], maxTokens: 4096 });
  return response.trim();
}
