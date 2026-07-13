/**
 * Beanburito template content spec.
 *
 * Every slot the beanburito homepage needs, with purpose, constraints, and
 * guidance so the LLM knows exactly what to write — not just "fill a headline"
 * but "write a 4-8 word outcome statement that leads with the member's result."
 *
 * This spec drives the generate stage prompt and the machine-readable template
 * definition consumed by the build/eval process. When the template changes,
 * update this single file and re-run the generate stage.
 */

import type { ComponentPropSpec, ComponentSpec, PageSpec, SectionSpec, TemplateSpec } from "./types.js";

export type { ComponentPropSpec, ComponentSpec, PageSpec, SectionSpec };

export const beanburitoSpec: TemplateSpec = {
  name: "beanburito",
  description: "Dark, bold, community-focused gym template. Large typography, high contrast, testimonials-first social proof.",
  headAssets: [
    { tag: "link", attrs: { rel: "stylesheet", href: "/styles/beanburito.css" } },
    { tag: "link", attrs: { rel: "stylesheet", href: "/assets/phosphor/phosphor-bold.css" } },
    {
      tag: "link",
      attrs: {
        rel: "preload",
        as: "font",
        href: "/assets/phosphor/Phosphor-Bold.woff2",
        type: "font/woff2",
        crossorigin: "anonymous",
      },
    },
  ],
  bodyClasses: ["theme-beanburito", "bg-black"],

  sections: {

    hero: {
      purpose: "Convert a first-time visitor to a lead within 3 seconds. The most important section on the site.",
      slots: {
        subheading: {
          purpose: "3-5 word label above the headline. Rendered ALL-CAPS. Sets location or brand context.",
          type: "string",
          maxWords: 5,
          guidance: "Use the gym's city name or a short brand qualifier. Not a full sentence — a label. Never start with 'We' or 'The'.",
          example: "Best Gym in Torrance",
        },
        headline: {
          purpose: "Main hero statement — the first and most important thing the visitor reads.",
          type: "string",
          required: true,
          maxWords: 8,
          guidance: "4-8 words. Bold outcome statement. Lead with what the MEMBER gets — strength, community, results, transformation. NEVER 'Welcome to [Gym]'. Use strong action verbs. Can use a period mid-sentence for rhythm (e.g. 'Build Strength. Find Your People.')",
          example: "Build Strength. Find Your Community.",
        },
        intro: {
          purpose: "1-2 sentence proof point below the headline. Grounds the bold claim in specifics.",
          type: "string",
          maxWords: 35,
          guidance: "Specific, credible, and human. Reference real things: how long they've been open, member count, what makes their coaching different, their location. Avoid clichés like 'state of the art' or 'world class'. If you know their story, use it.",
          example: "Trusted by 400+ Torrance residents since 2018. Our coaches build programs around your life — not the other way around.",
        },
        ctaLabel: {
          purpose: "Primary CTA button text. The single most important click on the page.",
          type: "string",
          maxWords: 4,
          guidance: "2-4 words. Action-oriented. First-person if possible. Remove friction — 'free', 'trial', 'tour' all reduce anxiety. Options: 'Start Your Free Trial', 'Book a Free Tour', 'Claim Your Spot', 'Join Us Today', 'Try It Free'",
          example: "Start Your Free Trial",
        },
        ctaUrl: {
          purpose: "Destination URL for the primary CTA button.",
          type: "string",
          guidance: "Use '/contact' if no specific booking URL is available. If the gym has a PushPress signup or Calendly URL, use it.",
          example: "/contact",
        },
      },
    },

    valueProps: {
      purpose: "Three quick benefits that help the visitor self-qualify. Answers: 'Is this gym right for me?'",
      count: 3,
      slots: {
        headline: {
          purpose: "The benefit name. Rendered ALL-CAPS.",
          type: "string",
          maxWords: 5,
          guidance: "2-5 words. Pick the gym's real differentiators from the docs. Not generic gym features — specific to who they are. e.g. 'Expert Coaching', 'Real Community', 'Every Fitness Level', 'Proven Programming'",
          example: "Start At Any Level",
        },
        body: {
          purpose: "One sentence expanding the benefit with specifics.",
          type: "string",
          maxWords: 24,
          guidance: "12-20 words. Concrete and specific. Name the type of person this serves if possible. Connect to the gym's identity from the docs. Keep it short enough to display fully in a 3-up card grid.",
          example: "Our coaches scale every workout to where you are today.",
        },
        icon: {
          purpose: "Phosphor bold icon name that visually represents this benefit.",
          type: "string",
          guidance: "Pick one Phosphor bold icon name in kebab-case. Must be a real icon name. Examples: barbell, users, target, calendar-check, lightning, user-gear, compass, notepad, fingerprint, drop, carrot, device-mobile, heart-beat, buildings, shield-check. If nothing fits, use 'star'.",
          example: "barbell",
        },
      },
    },

    howItWorks: {
      purpose: "Three steps showing how easy it is to get started. Reduces friction for the hesitant visitor.",
      count: 3,
      slots: {
        headline: {
          purpose: "Step name — what the visitor does.",
          type: "string",
          maxWords: 5,
          guidance: "2-5 words. Action phrase. Should flow as a logical journey: discovery → consultation → training. e.g. 'Book a Free Tour', 'Meet Your Coach', 'Start Training'",
          example: "Schedule a Free Consult",
        },
        body: {
          purpose: "One sentence making this step feel easy and low-commitment.",
          type: "string",
          maxWords: 28,
          guidance: "15-25 words. Remove anxiety. Use reassuring language: 'no commitment', 'at your own pace', 'whenever you're ready'. Make the gym feel approachable, not intimidating.",
          example: "Pick a time that works for you. We'll walk you through the gym and answer every question — no pressure, no sales pitch.",
        },
      },
    },

    howItWorksHeadline: {
      purpose: "Section headline for the how-it-works steps.",
      slots: {
        value: {
          purpose: "How-it-works section heading",
          type: "string",
          maxWords: 7,
          guidance: "4-7 words. Welcoming and action-oriented. Should frame the three steps as a simple path. e.g. 'Getting Started Is Simple', 'Your First Step Is Easy', 'Three Steps to a Better You'",
          example: "Getting Started Is Simple",
        },
      },
    },

    features: {
      purpose: "Up to 6 amenities or key offerings. Shows the gym has everything needed — no excuses.",
      count: 6,
      slots: {
        label: {
          purpose: "The amenity or offering name.",
          type: "string",
          maxWords: 5,
          guidance: "2-4 words. Real amenities from the gym's docs. If fewer than 6 real amenities are documented, use their actual program types or service offerings. e.g. 'Open Gym Access', 'Certified Coaches', 'Nutrition Guidance', 'Weekend Classes', 'Outdoor Training Area', 'Changing Rooms'",
          example: "Open Gym Access",
        },
        icon: {
          purpose: "Phosphor bold icon name that visually represents this amenity.",
          type: "string",
          guidance: "Pick one Phosphor bold icon name in kebab-case. Must be a real icon name. Examples: barbell, users, calendar-check, clock, car, drop, carrot, fork-knife, device-mobile, wifi-high, lockers, shower, t-shirt, toilet, buildings, shield-check, heart-beat, lightning, check. If nothing fits, use 'star'.",
          example: "clock",
        },
      },
    },

    communityHeadline: {
      purpose: "Headline for the emotional community section — the heart of the beanburito template.",
      slots: {
        value: {
          purpose: "Community section heading",
          type: "string",
          maxWords: 8,
          guidance: "4-8 words. Focus on belonging, support, and people — not equipment or programming. Emotionally resonant. This is where the gym's soul comes through. e.g. 'You Belong Here', 'More Than a Gym', 'A Community That Keeps You Going', 'Where You Actually Want to Show Up'",
          example: "A Community That Keeps You Going",
        },
      },
    },

    trustHeadline: {
      purpose: "Short social-proof headline shown above testimonials.",
      slots: {
        value: {
          purpose: "Social proof statement",
          type: "string",
          maxWords: 10,
          guidance: "5-10 words. Quantify if possible — member count, years in business, city reputation. e.g. 'Trusted by 500+ Members in Torrance', 'Loved by Our Community Since 2018', '400+ Members Can't Be Wrong'",
          example: "Trusted and Loved By Hundreds of Torrance Residents",
        },
      },
    },

    ctaHeadline: {
      purpose: "Final call-to-action headline at the bottom of the page. Distinct from the testimonials social-proof headline.",
      slots: {
        value: {
          purpose: "Bottom CTA headline",
          type: "string",
          maxWords: 8,
          guidance: "4-8 words. Action-oriented, focused on the next step. May echo the hero headline or primary outcome. e.g. 'Start Your Transformation Today', 'Take the First Step', 'Your Fitness Journey Starts Here'",
          example: "Start Your Transformation Today",
        },
      },
    },

  },

  components: {
    hero: {
      component: "Hero",
      purpose: "Full-viewport hero with background image, headline, intro, and primary CTA.",
      props: {
        hero: {
          purpose: "Hero content object.",
          type: "object",
          required: true,
          guidance: "HeroContent shape: headline, subheading, intro, ctaLabel, ctaUrl, backgroundImageUrl.",
          example: "{ headline: 'Build Strength. Find Your Community.', ... }",
          source: { kind: "pageField", path: "hero" },
        },
      },
    },

    programs: {
      component: "Programs",
      purpose: "Grid of featured program cards with sticky headline and CTA.",
      props: {
        headline: {
          purpose: "Headline above the program grid.",
          type: "string",
          maxWords: 8,
          guidance: "Action-oriented, specific to the gym's programming.",
          example: "Programs Built For You",
          source: { kind: "field", path: "pages.home.programsHeadline" },
        },
        subheadline: {
          purpose: "Short supporting line below the headline.",
          type: "string",
          maxWords: 10,
          guidance: "Sets the emotional frame for the program grid.",
          example: "Find a fitness routine that works for you",
          source: { kind: "field", path: "pages.home.programsSubheadline" },
        },
        slugs: {
          purpose: "Program slugs to render in the grid.",
          type: "string[]",
          required: true,
          guidance: "Array of program slugs from GymSiteContent.pages.programs.",
          example: "[fundamentals, strength, nutrition]",
          source: { kind: "field", path: "pages.home.featuredPrograms" },
        },
      },
    },

    location: {
      component: "Location",
      purpose: "Address, hours, map embed, and service area for the gym.",
      props: {},
    },

    benefits: {
      component: "IconCardGrid",
      purpose: "Three benefit/value-prop cards with icons.",
      props: {
        items: {
          purpose: "Benefit headline + body objects.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's valueProps, falling back to home.valueProps.",
          example: "[{ icon: 'star', headline: '...', body: '...' }, ...]",
          source: { kind: "pageField", path: "valueProps" },
        },
      },
    },

    ctaBand: {
      component: "CTABand",
      purpose: "Full-width call-to-action band.",
      props: {
        headline: {
          purpose: "CTA headline.",
          type: "string",
          required: true,
          maxWords: 8,
          guidance: "Short, outcome-focused. Uses the page's ctaHeadline, falling back to trustHeadline or a generic CTA.",
          example: "Start Your Transformation Today",
          source: { kind: "pageField", path: "ctaHeadline" },
        },
        subtext: {
          purpose: "One-line supporting copy below the headline.",
          type: "string",
          maxWords: 12,
          guidance: "Reduces friction. e.g. 'Fill out the form and a coach will reach out within 24 hours.'",
          example: "Fill out the form and a coach will reach out within 24 hours.",
          source: { kind: "field", path: "pages.home.ctaSubtext" },
        },
        ctaLabel: {
          purpose: "Button label.",
          type: "string",
          maxWords: 4,
          guidance: "Action-oriented. Falls back to business.primaryCta.label.",
          example: "Join Now",
          source: { kind: "field", path: "business.primaryCta.label" },
        },
        ctaUrl: {
          purpose: "Button URL.",
          type: "string",
          guidance: "Internal path or external URL. Falls back to business.primaryCta.url.",
          example: "/contact",
          source: { kind: "field", path: "business.primaryCta.url" },
        },
      },
    },

    valueProps: {
      component: "IconCardGrid",
      purpose: "Three benefit cards (alias of benefits for homepage naming).",
      props: {
        items: {
          purpose: "Benefit headline + body objects.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's valueProps, falling back to home.valueProps.",
          example: "[{ headline, body }...]",
          source: { kind: "pageField", path: "valueProps" },
        },
      },
    },

    howItWorks: {
      component: "HowItWorks",
      purpose: "Three-step getting-started sequence.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          maxWords: 7,
          guidance: "Welcoming and action-oriented.",
          example: "Getting Started Is Simple",
          source: { kind: "pageField", path: "howItWorksHeadline" },
        },
        steps: {
          purpose: "Step objects with number, headline, body.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's howItWorks, falling back to home.howItWorks.",
          example: "[{ number, headline, body }...]",
          source: { kind: "pageField", path: "howItWorks" },
        },
      },
    },

    amenities: {
      component: "IconCardGrid",
      purpose: "Up to 6 icon-card features rendered as a dense, dark grid.",
      props: {
        items: {
          purpose: "Feature objects.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's features, falling back to home.features.",
          example: "[{ icon: 'star', label: 'Open Gym Access' }, ...]",
          source: { kind: "pageField", path: "features" },
        },
        headline: {
          purpose: "Optional section headline.",
          type: "string",
          maxWords: 8,
          guidance: "Leave unset to render without a headline.",
          example: "Everything you need to crush your fitness goals",
        },
      },
    },

    community: {
      component: "Community",
      purpose: "Emotional community section with text and optional image.",
      props: {
        headline: {
          purpose: "Community section heading.",
          type: "string",
          maxWords: 8,
          guidance: "Focus on belonging and people.",
          example: "A Community That Keeps You Going",
          source: { kind: "pageField", path: "communityHeadline" },
        },
        items: {
          purpose: "Community value props rendered as body copy.",
          type: "object",
          guidance: "Rendered from the current page's communityProps, falling back to home.communityProps.",
          example: "[{ icon, headline, body }...]",
          source: { kind: "pageField", path: "communityProps" },
        },
        imageUrl: {
          purpose: "Optional side image.",
          type: "string",
          guidance: "Leave empty to render text only.",
          example: "/assets/beanburito/community.webp",
        },
      },
    },

    testimonials: {
      component: "Testimonials",
      purpose: "Member testimonials band.",
      props: {
        headline: {
          purpose: "Social-proof banner headline.",
          type: "string",
          maxWords: 10,
          guidance: "Quantify if possible.",
          example: "Trusted by 500+ Members in Torrance",
          source: { kind: "pageField", path: "trustHeadline" },
        },
        items: {
          purpose: "Member testimonial objects.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's testimonials, falling back to home.testimonials.",
          example: "[{ quote, name, program }...]",
          source: { kind: "pageField", path: "testimonials" },
        },
      },
    },

    faq: {
      component: "FAQ",
      purpose: "FAQ accordion with schema markup.",
      props: {
        items: {
          purpose: "FAQ question/answer objects.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's faq, falling back to home.faq.",
          example: "[{ question, answer }...]",
          source: { kind: "pageField", path: "faq" },
        },
        headline: {
          purpose: "FAQ section heading.",
          type: "string",
          maxWords: 8,
          guidance: "Defaults to 'Questions? We have the answers!' in component.",
          example: "Questions? We have the answers!",
        },
      },
    },

    iframeBand: {
      component: "IframeBand",
      purpose: "Sandboxed third-party iframe embeds captured from the source site or added by an admin/AI. Each embed carries its own src and an optional template variant for styling.",
      conditional: true,
      props: {
        iframes: {
          purpose: "Iframe embed objects to render.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's iframes, falling back to home.iframes. Maps live in the Location section, so skip any embed whose variant is 'map'. Variants are defined by the template (review, schedule, form, video, default) and only affect default styling; all dimensions, titles, sandbox, and style overrides can be set per-embed.",
          example: "[{ src: 'https://widget.trustpilot.com/...', variant: 'review', title: 'What our members say' }, ...]",
          source: { kind: "pageField", path: "iframes" },
        },
      },
    },
  },

  pages: {
    home: {
      path: "/",
      components: [
        "hero",
        "valueProps",
        "programs",
        "howItWorks",
        "amenities",
        "community",
        "location",
        "testimonials",
        "iframeBand",
        "faq",
        "ctaBand",
      ],
    },
    about: {
      path: "/about",
      components: ["hero", "community", "testimonials", "iframeBand", "ctaBand", "location"],
    },
    contact: {
      path: "/contact",
      components: ["hero", "location", "faq", "iframeBand", "ctaBand"],
    },
    pricing: {
      path: "/pricing",
      components: ["hero", "amenities", "faq", "ctaBand"],
    },
    schedule: {
      path: "/schedule",
      components: ["hero", "ctaBand", "location", "iframeBand"],
    },
    localGuide: {
      path: "/local-guide",
      components: ["hero", "amenities", "ctaBand", "location"],
    },
  },
};

/** Build the section-by-section prompt text from the spec. */
export function buildSpecPrompt(spec: TemplateSpec): string {
  const lines: string[] = [
    `TEMPLATE: ${spec.name}`,
    `STYLE: ${spec.description}`,
    ``,
    `Fill each section below using the gym's real information from the context above.`,
    `Follow each spec's guidance exactly — purpose, word count, tone.`,
    ``,
  ];

  for (const [sectionKey, section] of Object.entries(spec.sections)) {
    lines.push(`=== SECTION: ${sectionKey.toUpperCase()} ===`);
    lines.push(`Purpose: ${section.purpose}`);
    if (section.count) lines.push(`Count: exactly ${section.count} items`);
    lines.push(``);

    for (const [slotKey, slot] of Object.entries(section.slots)) {
      lines.push(`  ${slotKey}:`);
      lines.push(`    Purpose: ${slot.purpose}`);
      if (slot.maxWords) lines.push(`    Max words: ${slot.maxWords}`);
      lines.push(`    Guidance: ${slot.guidance}`);
      lines.push(`    Example: "${slot.example}"`);
      lines.push(``);
    }
  }

  return lines.join("\n");
}
