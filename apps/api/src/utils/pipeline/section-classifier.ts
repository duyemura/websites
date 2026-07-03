import type { CanonicalSectionTag } from "../../types/pipeline-artifacts";
import { CanonicalSectionTagSchema } from "../../types/pipeline-artifacts";

interface ClassifiableSection {
  headingText?: string;
  innerText: string;
  landmarkTag?: string;   // header/footer/nav — already known structurally
}

// Narrow duck-type of chatWithLlm — consumers pass a bound wrapper.
type ChatFn = (req: {
  model?: string;
  messages: Array<{ role: "user"; content: string }>;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ content: string }>;

const CLASSIFY_PROMPT = (items: Array<{ index: number; heading: string; text: string }>) => `
Classify each website section from a gym website into exactly one of these types:
hero, feature-grid, testimonial-band, cta-band, content-block, media-block, location-block,
faq-block, social-proof-band, steps-band, schedule, team, contact, unknown

Sections:
${JSON.stringify(items, null, 2)}

Return ONLY a JSON array: [{"index": number, "tag": string}, ...]. No prose.`;

export async function classifySections(
  sections: ClassifiableSection[],
  chat: ChatFn,
): Promise<CanonicalSectionTag[]> {
  const result: CanonicalSectionTag[] = sections.map((s) =>
    s.landmarkTag === "header" ? "header" : s.landmarkTag === "footer" ? "footer" : "unknown",
  );

  const toClassify = sections
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => !s.landmarkTag);
  if (toClassify.length === 0) return result;

  const items = toClassify.map(({ s, index }) => ({
    index,
    heading: s.headingText ?? "",
    text: s.innerText.slice(0, 300),
  }));

  try {
    const response = await chat({
      messages: [{ role: "user", content: CLASSIFY_PROMPT(items) }],
      temperature: 0,
      maxTokens: 1024,
    });
    const parsed = JSON.parse(extractJson(response.content)) as Array<{ index: number; tag: string }>;
    for (const { index, tag } of parsed) {
      const check = CanonicalSectionTagSchema.safeParse(tag);
      if (check.success && result[index] !== undefined) result[index] = check.data;
    }
  } catch {
    // classification failure leaves sections as "unknown" — build renders them generically
  }
  return result;
}

function extractJson(text: string): string {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : text;
}
