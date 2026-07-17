export interface VisionIssue {
  property: string;
  expected: string;
  actual: string;
  severity: "critical" | "major" | "minor";
}

export interface VisionDiffResult {
  score: number;
  issues: VisionIssue[];
  failed?: boolean; // true when the diff itself failed (image load error, JSON parse error)
}

type ChatFn = (req: {
  messages: Array<{ role: "user"; content: unknown }>;
  maxTokens?: number;
}) => Promise<string>;

const PROMPT = `Compare these two screenshots of the same website section.
Image 1 is the original design. Image 2 is the generated Astro component rendered in a browser.

SCORING RULES (read carefully before scoring):
1. IGNORE all background images — sections that use a hero image in the original should be compared
   as if both have the same solid color/gradient background. A missing hero photo is NOT a design
   difference; focus only on layout, typography, and spacing that exists independent of the image.
2. IGNORE text content differences (placeholder text vs real copy).
3. DO compare:
   - Section layout: columns, rows, grid structure, element alignment and proportions
   - Typography: approximate font sizes, font weights, letter-spacing, line-height
   - Spacing: padding, margins, gaps between elements
   - Color treatment of UI elements: card backgrounds, button colors, text colors
   - Borders, border-radius, box-shadows on cards, buttons, and UI elements
   - Number and arrangement of visual blocks (how many cards, columns, rows)

A score of 85+ means the layout structure, typography hierarchy, and spacing are a close match,
even if the exact pixel values differ slightly.
A score of 65 means major layout or typography differences exist.
A score below 50 means the section type or structure is fundamentally different.

Score visual fidelity 0-100. List up to 8 DESIGN differences as specific CSS fixes.

Respond with JSON only — no explanation, no markdown:
{
  "score": <0-100>,
  "issues": [
    { "property": "<CSS property>", "expected": "<value>", "actual": "<value>", "severity": "critical|major|minor" }
  ]
}`;

function extractMedia(uri: string): { mediaType: string; data: string } {
  const match = uri.match(/^data:([^;]+);base64,(.+)$/);
  return {
    mediaType: match?.[1] ?? "image/png",
    data: match?.[2] ?? "",
  };
}

export async function visionDiff(
  originalCropUrl: string,
  renderedCropUrl: string,
  chatFn: ChatFn,
  loadImageFn?: (url: string) => Promise<string>,
): Promise<VisionDiffResult> {
  const content: unknown[] = [{ type: "text", text: PROMPT }];

  if (loadImageFn) {
    try {
      const origData = await loadImageFn(originalCropUrl);
      const rendData = await loadImageFn(renderedCropUrl);
      const orig = extractMedia(origData);
      const rend = extractMedia(rendData);
      content.push(
        {
          type: "image",
          source: { type: "base64", media_type: orig.mediaType, data: orig.data },
        },
        { type: "text", text: "↑ Original (Image 1). ↓ Rendered (Image 2)." },
        {
          type: "image",
          source: { type: "base64", media_type: rend.mediaType, data: rend.data },
        },
      );
    } catch (err) {
      console.warn("[visual-diff] Failed to load images for comparison:", err instanceof Error ? err.message : String(err));
      return { score: 0, issues: [], failed: true };
    }
  }

  try {
    const response = await chatFn({
      messages: [{ role: "user", content }],
      maxTokens: 2048,
    });
    const jsonStr = response.match(/\{[\s\S]*\}/)?.[0] ?? "";
    const parsed = JSON.parse(jsonStr) as { score?: unknown; issues?: unknown };
    return {
      score: typeof parsed.score === "number" ? parsed.score : 0,
      issues: Array.isArray(parsed.issues) ? (parsed.issues as VisionIssue[]) : [],
    };
  } catch (err) {
    console.warn("[visual-diff] Failed to parse LLM response as JSON:", err instanceof Error ? err.message : String(err));
    return { score: 0, issues: [], failed: true };
  }
}
