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
      messages: [{ role: "user", content: `Write a 300-word personality guide for the "${templateName}" gym website template. An AI will read this to write copy and select images for a real gym's website.

This is a gym/fitness business website template. Begin by identifying which category of gym this template best suits — choose one or two from: CrossFit/functional fitness, martial arts, boutique fitness studio, traditional gym, personal training studio, yoga/wellness. Explain which visual and typographic signals led to that call.

Then describe:
- **Brand voice register**: Is this template aggressive/motivational, welcoming/community-focused, premium/exclusive, or approachable/fun? Give a one-sentence voice brief an AI copywriter can follow.
- **Hero copy guidance**: What emotional register should the headline hit? (Transformation? Belonging? Performance?) What should the subheadline do? Note: the city name should appear in the hero headline or subheadline naturally — "Austin's most welcoming CrossFit gym" ranks and converts better than "CrossFit gym Austin Texas". Target 2-3 natural city name appearances per page overall: once in the hero area, once in a section body, once in the footer or contact area.
- **Testimonial style**: Should quotes be short and punchy or narrative and detailed? Should they mention specific results ("lost 20 lbs", "hit my first pull-up") or focus on atmosphere and community?
- **Program description style**: Lead with the outcome or the method? How technical should the language be?
- **CTA tone**: Always low-commitment — the primary CTA everywhere should be the first small step ("Book a free intro class", "Claim your free week", "Try a class free"), never high-friction language like "Join now" or "Sign up" as the main ask. The header must carry a persistent CTA button. Every section should offer a path to that same low-commitment action. All CTA labels and destination URLs must come from the gym's \`business.primaryCta\` field — never hardcode CTA text or links.
- **Imagery direction**: Gritty action shots, clean lifestyle photography, community celebration, or polished studio aesthetics? What to avoid?

Section data:
${JSON.stringify(sectionSummary, null, 2)}

CSS tokens (first 1500 chars):
${cssSource.slice(0, 1500)}` }],
      maxTokens: 600,
    }),

    chatFn({
      messages: [{ role: "user", content: `Document each component in the "${templateName}" gym website template for an AI content generator that will fill real gym content into each slot.

Every component on a gym website serves a conversion goal. For each component below, document:
1. **Conversion role**: What is this component's job in the visitor's decision to join? (e.g., "hero converts curious visitors into form submitters", "program cards build desire by making workouts feel accessible", "testimonials overcome the 'this isn't for me' objection", "CTA band captures leads who scrolled past the hero")
2. **Content slots**: For each fillable slot, what gym-specific content goes there — be concrete. For example: hero headline should name the *transformation outcome* ("Get strong. Feel confident."), not the gym name or workout type. Subheadline should address the visitor's fear or objection in one sentence.
3. **Length and tone**: Exact guidance (e.g., "headline: 4–7 words, punchy", "body copy: 2 sentences max, present tense, second person").
4. **What to avoid**: Common mistakes that weaken gym conversion (e.g., "don't open with the gym name", "don't use vague praise in testimonials — require a specific result", "don't write CTAs that say 'Learn more' or 'Contact us' — always name the action and reduce perceived commitment").

Key rules to apply across all components:
- Hero headlines: outcome-focused, not feature-focused ("Get your first pull-up in 8 weeks" beats "State-of-the-art CrossFit facility"). Include the city name naturally in the hero headline or subheadline — this signals local relevance to both visitors and search engines.
- Testimonials: must include a specific result or named before/after change, not generic praise ("Changed my life" is weak; "I lost 18 lbs and finally did a muscle-up" is strong)
- CTA copy: every CTA button must use \`business.primaryCta.label\` as the label and \`business.primaryCta.href\` as the destination — never hardcode text or links. Reduce perceived commitment ("Book a free intro class" beats "Join now" or "Contact us").
- Program cards: lead with the benefit the member gets, not the workout type or class name. Body copy for each program/service card should be 3–5 sentences — Google needs content depth to rank program pages for searches like "[program type] gym [city]", and thin cards don't rank.

Components:
${JSON.stringify(sectionSummary, null, 2)}` }],
      maxTokens: 900,
    }),

    chatFn({
      messages: [{ role: "user", content: `Document the page archetypes for the "${templateName}" gym website template for an AI content generator that will populate each page with real gym content.

Every page in the gym sales funnel answers a specific visitor question and serves a specific stage of the decision to join. For each page in the map below, document:

1. **Funnel stage**: Where is this visitor in their decision? (Awareness = just discovered us; Consideration = comparing options; Intent = ready to act; Commitment = deciding on tier/plan; Conversion = taking the final step)
2. **Visitor's question at this stage**: What is the single thing they most need answered? Be specific to gym buying behavior.
3. **What the page must deliver**: The essential content, proof, or evidence it must include to move the visitor forward. Examples by page:
   - *Home*: Immediately communicate "what kind of gym, for what kind of person" — category signal + transformation promise + low-commitment CTA
   - *About*: Build trust via coach credentials, gym origin story, and community proof — visitors here are asking "will I belong here and will these coaches actually help me?"
   - *Pricing/Plans*: Handle the "is this worth it?" objection — anchor value before showing price, name what's included, reduce sticker shock with a per-day or per-session breakdown
   - *Schedule*: Reduce friction to the first session — show class variety, beginner-friendly options prominently, and make booking feel easy
   - *Contact*: Capture the lead — this visitor is ready; one clear action, no distractions
4. **Proof and evidence for this stage**: What testimonials, stats, credentials, or social proof belongs on this specific page?
5. **Primary conversion action**: The single most important thing the visitor should do next. Every page drives one primary action — always the low-commitment first step from \`business.primaryCta\` ("Book a free intro class", "Try your first class free"). Reserve "Join" language for the pricing/plans page only after value has been established.
6. **SEO requirements for this page**:
   - Every page needs a unique, descriptive H1 that includes the city name where natural. The home page H1 should be outcome-focused and location-aware (e.g., "Get Strong in Austin" not "Welcome to Our Gym").
   - Program pages must target 400+ words of body content: what the program is, who it's for, results members get, what a typical session looks like, and 2-3 FAQs. These pages rank for "[program] gym [city]" — they are the highest-value SEO pages on the site and thin content will not rank.
   - The contact page must display full NAP (business name, street address, phone number) as visible text on the page — not only embedded in a map or hidden in metadata. Search engines use visible NAP text for local ranking signals.

Page map (path → components in order):
${JSON.stringify(pageMap, null, 2)}` }],
      maxTokens: 800,
    }),
  ]);

  return { personality, components, pageArchetypes };
}
