import type { ComponentGroup } from "./section-grouper";

type ChatFn = (req: {
  messages: Array<{ role: "user"; content: string }>;
  maxTokens?: number;
}) => Promise<string>;

export interface TemplateDocs {
  personality: string;
  components: string;
  pageArchetypes: string;
}

export async function generateTemplateDocs(
  templateName: string,
  groups: ComponentGroup[],
  pageMap: Record<string, string[]>,
  cssSource: string,
  chatFn: ChatFn,
): Promise<TemplateDocs> {
  const sectionSummary = groups.map((g) => ({
    component: g.name,
    tag: g.tag,
    archetype: g.archetype,
    typography: g.exemplar.contract.typography,
    background: g.exemplar.contract.layout.background,
    spacing: g.exemplar.contract.layout.spacing,
  }));

  const [personality, components, pageArchetypes] = await Promise.all([
    chatFn({
      messages: [{ role: "user", content: `Write a 300-word personality guide for the "${templateName}" gym website template. An AI will read this to write copy and pick images.

Cover: visual tone, typography character, color mood, layout tendencies, which gym types this suits.

Section data:
${JSON.stringify(sectionSummary, null, 2)}

CSS tokens (first 1500 chars):
${cssSource.slice(0, 1500)}` }],
      maxTokens: 600,
    }),

    chatFn({
      messages: [{ role: "user", content: `Document each component in the "${templateName}" gym website template for an AI content generator.

For each component: what it renders, what each prop slot expects (content type, length, tone), constraints.

Components:
${JSON.stringify(sectionSummary, null, 2)}` }],
      maxTokens: 900,
    }),

    chatFn({
      messages: [{ role: "user", content: `Document the page archetypes for the "${templateName}" gym website template for an AI content generator.

For each page: visitor intent, component sequence, content priorities, what makes a strong version for a gym.

Page map (path → components in order):
${JSON.stringify(pageMap, null, 2)}` }],
      maxTokens: 800,
    }),
  ]);

  return { personality, components, pageArchetypes };
}
