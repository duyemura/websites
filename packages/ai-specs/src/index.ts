// Component AI generation specs registry.
// Each section type declares how its props should be filled by the AI pipeline.

export interface ComponentAISpec {
  type: string;
  description: string;
  props: Record<
    string,
    {
      strategy: "llm" | "context" | "default" | "asset" | "image";
      description?: string;
      default?: unknown;
    }
  >;
}

export const registry: Record<string, ComponentAISpec> = {
  Hero: {
    type: "Hero",
    description: "A large hero section with headline, subheadline, and CTA.",
    props: {
      title: { strategy: "llm", description: "Main headline" },
      subtitle: { strategy: "llm", description: "Supporting subheadline" },
      ctaLabel: { strategy: "default", default: "Book a free session" },
      ctaHref: { strategy: "default", default: "#book" },
      backgroundImage: { strategy: "asset" },
    },
  },
  Text: {
    type: "Text",
    description: "A rich text content block.",
    props: {
      content: { strategy: "llm", description: "Markdown content" },
    },
  },
  Plans: {
    type: "Plans",
    description: "Membership or class plan cards.",
    props: {
      heading: { strategy: "llm", description: "Section heading" },
      plans: { strategy: "context", description: "Plans from workspace docs" },
    },
  },
};
