export interface VisionIssue {
  property: string;
  expected: string;
  actual: string;
  severity: "critical" | "major" | "minor";
}

export interface VisionDiffResult {
  score: number;
  issues: VisionIssue[];
}

type ChatFn = (req: {
  messages: Array<{ role: "user"; content: unknown }>;
  maxTokens?: number;
}) => Promise<string>;

const PROMPT = `Compare these two screenshots of the same website section.
Image 1 is the original design. Image 2 is the generated Astro component rendered in a browser.

IMPORTANT: Ignore specific text content and placeholder images — you are comparing DESIGN ONLY:
- Layout and composition (columns, grid, alignment, proportions)
- Background colors, gradients, and overlay opacity
- Typography: font sizes, font weights, letter-spacing, line-height
- Spacing: padding, margins, gaps between elements
- Borders, border-radius, box-shadows
- Overall visual hierarchy and structure

Score visual fidelity 0-100 (100 = identical design, ignoring placeholder content). List every DESIGN difference as a specific CSS fix.

Respond with JSON only:
{
  "score": <0-100>,
  "issues": [
    { "property": "<CSS property or layout element>", "expected": "<value from original>", "actual": "<value rendered>", "severity": "critical|major|minor" }
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
      console.warn("[visual-diff] Failed to load images for comparison:", err);
      return { score: 0, issues: [] };
    }
  }

  try {
    const response = await chatFn({
      messages: [{ role: "user", content }],
      maxTokens: 1024,
    });
    const jsonStr = response.match(/\{[\s\S]*\}/)?.[0] ?? "";
    const parsed = JSON.parse(jsonStr) as { score?: unknown; issues?: unknown };
    return {
      score: typeof parsed.score === "number" ? parsed.score : 0,
      issues: Array.isArray(parsed.issues) ? (parsed.issues as VisionIssue[]) : [],
    };
  } catch {
    return { score: 0, issues: [] };
  }
}
