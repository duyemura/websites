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

SCORING RULES:
1. IGNORE placeholder text (e.g. "Placeholder headline", "Gym Name") vs real copy — content differs by design.
2. IGNORE missing photos inside cards or as hero backgrounds — these are data-dependent, not design flaws.
   HOWEVER: if the original section has a light background and the generated one is dark (or vice versa),
   that IS a design difference and should lower the score significantly.
3. DO score these accurately:
   - Background color of the section (light vs dark — this matters even when background images are absent)
   - CTA button color, shape, and prominence
   - Typography: font sizes, font weights, letter-spacing, line-height
   - Section layout: columns, grid, alignment, proportions
   - Spacing: padding, margins, gaps
   - Card/element borders, border-radius, box-shadows
   - Overall light vs dark theme treatment

CALIBRATION:
- 90+: Near-identical design — same background tone, same button color, same typography scale
- 75-89: Close match — minor spacing or size differences, same overall theme
- 50-74: Partial match — layout is similar but theme (light/dark) or accent color is wrong
- below 50: Section type or fundamental design is different

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
