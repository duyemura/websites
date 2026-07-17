// Auto-generated spec writer for Milo template pipeline.
import type { ComponentGroup } from "./section-grouper";

// Maps semantic prop names (as instructed in astro-generator prompt) to ComponentPropSpec fields.
// Generated components use these names by convention — headline, subheadline, ctaText, etc.
// The `source` field wires each prop to its location in GymSiteContent so the template resolver
// can populate it at render time. Without a source, resolvePropValue returns undefined and the
// component is skipped. See apps/renderer/src/lib/template-resolver.ts for how sources are consumed.
const PROP_HINTS: Record<
  string,
  {
    purpose: string;
    type: "string" | "number" | "boolean" | "string[]" | "object";
    required: boolean;
    guidance: string;
    example: string;
    source: { kind: string; [k: string]: string };
  }
> = {
  headline: { purpose: "Main heading text", type: "string", required: true, guidance: "3-8 words, outcome-focused, active voice", example: "Transform Your Life", source: { kind: "pageField", path: "hero.headline" } },
  subheadline: { purpose: "Supporting subtitle text", type: "string", required: false, guidance: "1-2 sentences, expand on the headline", example: "Join our community and reach your goals.", source: { kind: "pageField", path: "hero.subheading" } },
  ctaText: { purpose: "Call-to-action button label", type: "string", required: false, guidance: "2-4 words, imperative verb, low commitment", example: "Book a free class", source: { kind: "pageField", path: "hero.ctaLabel" } },
  ctaHref: { purpose: "Call-to-action button URL", type: "string", required: false, guidance: "Internal path, e.g. /contact", example: "/contact", source: { kind: "pageField", path: "hero.ctaUrl" } },
  backgroundImageUrl: { purpose: "Background image URL", type: "string", required: false, guidance: "High-res photo, 1440px wide minimum", example: "__NO_IMAGE__", source: { kind: "pageField", path: "hero.backgroundImageUrl" } },
  items: { purpose: "Array of content items for this section", type: "object", required: false, guidance: "2-6 items, each with a title and description", example: "[]", source: { kind: "computed", fn: "features" } }, // default; overridden per-component by inferItemsSource()
  body: { purpose: "Body/description text", type: "string", required: false, guidance: "1-3 sentences", example: "Join our community of dedicated athletes.", source: { kind: "pageField", path: "gymStory" } },
};

/** Picks the right computed fn for the `items` prop based on the component's name.
 *  Using a single `features` default for all sections is wrong — testimonials,
 *  FAQ, and program cards each need different content from GymSiteContent. */
function inferItemsSource(componentName: string): { kind: string; [k: string]: string } {
  const n = componentName.toLowerCase();
  if (n.includes("testimonial") || n.includes("review")) return { kind: "computed", fn: "testimonials" };
  if (n.includes("faq") || n.includes("question")) return { kind: "computed", fn: "faq" };
  if (n.includes("program") || n.includes("class") || n.includes("card")) return { kind: "computed", fn: "programs" };
  if (n.includes("how") || n.includes("steps") || n.includes("process")) return { kind: "computed", fn: "howItWorks" };
  return { kind: "computed", fn: "features" };
}

function inferPropsForComponent(componentName: string): string {
  const name = componentName.toLowerCase();
  const propsToInclude: string[] = [];

  // Every section has a headline (skip structural chrome)
  if (!name.includes("footer") && !name.includes("header") && !name.includes("nav")) {
    propsToInclude.push("headline");
  }
  // Hero sections
  if (name.includes("hero")) {
    propsToInclude.push("subheadline", "ctaText", "ctaHref", "backgroundImageUrl");
  }
  // CTA sections
  if (name.includes("cta")) {
    propsToInclude.push("ctaText", "ctaHref");
  }
  // Grid/card/feature/program sections
  if (name.includes("grid") || name.includes("card") || name.includes("program") || name.includes("feature")) {
    propsToInclude.push("items");
  }
  // Testimonial/FAQ/Team/Coach/Steps sections
  if (name.includes("testimonial") || name.includes("faq") || name.includes("team") || name.includes("coach") || name.includes("steps") || name.includes("how")) {
    propsToInclude.push("items");
  }
  // Location/contact sections
  if (name.includes("location") || name.includes("contact")) {
    propsToInclude.push("body");
  }

  const unique = [...new Set(propsToInclude)].filter((p) => PROP_HINTS[p] !== undefined);
  if (unique.length === 0) return "props: {}";

  const entries = unique.map((p) => {
    const spec = PROP_HINTS[p]!;
    // For `items`, override the default source with one matched to this component.
    const source = p === "items" ? inferItemsSource(componentName) : spec.source;
    return `        "${p}": { purpose: ${JSON.stringify(spec.purpose)}, type: "${spec.type}", required: ${spec.required}, guidance: ${JSON.stringify(spec.guidance)}, example: ${JSON.stringify(spec.example)}, source: ${JSON.stringify(source)} }`;
  });

  return `props: {\n${entries.join(",\n")}\n      }`;
}

const VALID_ARCHETYPES = new Set([
  "home",
  "program",
  "programIndex",
  "about",
  "contact",
  "schedule",
  "pricing",
  "blogIndex",
  "blogPost",
  "content",
  "team",
  "form",
]);

const KNOWN_ARCHETYPES: Record<string, string> = {
  "/": "home",
  "/about": "about",
  "/contact": "contact",
  "/pricing": "pricing",
  "/schedule": "schedule",
  "/programs": "programIndex",
  "/blog": "blogIndex",
  "/legal": "content",
};

const CANONICAL_PAGES: Record<string, { key: string; archetype: string; fallbackComponents: string[] }> = {
  "/": { key: "home", archetype: "home", fallbackComponents: ["Unknown"] },
  "/about": { key: "about", archetype: "about", fallbackComponents: ["Unknown"] },
  "/contact": { key: "contact", archetype: "contact", fallbackComponents: ["Unknown"] },
  "/pricing": { key: "pricing", archetype: "pricing", fallbackComponents: ["Unknown"] },
  "/schedule": { key: "schedule", archetype: "schedule", fallbackComponents: ["Unknown"] },
  "/programs": { key: "programIndex", archetype: "programIndex", fallbackComponents: ["Unknown"] },
  "/programs/:slug": { key: "program", archetype: "program", fallbackComponents: ["Unknown"] },
  "/blog": { key: "blog", archetype: "blogIndex", fallbackComponents: ["Unknown"] },
  "/legal": { key: "legal", archetype: "content", fallbackComponents: ["Unknown"] },
};

export function generateTemplateSpecSource(
  name: string,
  groups: ComponentGroup[],
  pageMap: Record<string, string[]>,
): string {
  const componentsBlock = groups
    .map(
      (g) => `    "${g.name}": {
      component: "${g.name}",
      purpose: "${g.tag} — ${g.archetype} layout",
      ${inferPropsForComponent(g.name)},
    }`,
    )
    .join(",\n");

  // Ensure every canonical renderer page exists in the spec, even if the
  // reference site did not include it. Use discovered components when
  // available; otherwise fall back to a generic placeholder so the eval build
  // can render all routes.
  const mergedPageMap: Record<string, string[]> = { ...pageMap };
  for (const [path, { fallbackComponents }] of Object.entries(CANONICAL_PAGES)) {
    if (!mergedPageMap[path] || mergedPageMap[path].length === 0) {
      mergedPageMap[path] = fallbackComponents;
    }
  }

  const pagesBlock = Object.entries(mergedPageMap)
    .map(([p, components]) => {
      const canonical = CANONICAL_PAGES[p];
      const key = canonical?.key ?? (p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "-") || "home");
      const derived = canonical?.archetype ?? KNOWN_ARCHETYPES[p] ?? key.split("-")[0] ?? "content";
      const archetype = VALID_ARCHETYPES.has(derived) ? derived : "content";
      return `    "${key}": {
      path: "${p}",
      archetype: "${archetype}",
      components: ${JSON.stringify(components)},
    }`;
    })
    .join(",\n");

  return `// Auto-generated by milo template pipeline — review and enrich before shipping.
import type { TemplateSpec } from "./types.js";

export const ${name}Spec: TemplateSpec = {
  name: "${name}",
  description: "Auto-generated from ${name} reference site.",
  sections: {},
  components: {
${componentsBlock}
  },
  pages: {
${pagesBlock}
  },
};
`;
}
