import type { TemplateSpec } from "./types.js";

/**
 * Modern template — based on the Beta Gym (beanburito.github.io/pushpress-site-modern/) design.
 * Light-themed: white/grey backgrounds, Montserrat headings, Barlow body, #0464fc blue CTAs.
 * Sections are reusable across page types (home, program, about).
 */
export const modernSpec: TemplateSpec = {
  name: "modern",
  description: "Clean, modern gym template. Light backgrounds, bold Montserrat headings, blue CTAs. Programs section with alternating image+text.",

  /**
   * Detected section type → component that renders it.
   * Human-maintained. Add new entries via `milo template add-component`.
   * spec-audit will report any source sections not covered here.
   */
  sectionMapping: {
    "hero/hero-center":                    "Hero",
    "hero/hero-left":                      "Hero",
    "hero/hero-right":                     "Hero",
    "content-block/feature-grid-even":     "CoreValues",
    "feature-grid/feature-grid-even":      "CoreValues",
    "feature-grid/program-cards-sticky":   "Programs",
    "content-block/content-media":         "Programs",
    "media-block/content-media":           "Programs",
    "steps-band/steps-numbered":           "HowItWorks",
    "testimonial-band/testimonial-scroll": "Testimonials",
    "social-proof-band/testimonial-scroll":"Testimonials",
    "content-block/amenities":             "Amenities",
    "feature-grid/feature-grid-bento":     "Amenities",
    "content-block/community":             "Community",
    "location-block/location-split":       "Location",
    "faq-block/faq-accordion":             "FAQ",
    "cta-band/cta-band":                   "CTABand",
    "cta-band/cta-simple":                 "CTABand",
  },

  headAssets: [
    {
      tag: "link",
      attrs: {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;800;900&family=Barlow:wght@300;400;600;700&display=swap",
      },
    },
    { tag: "link", attrs: { rel: "stylesheet", href: "/styles/modern.css" } },
  ],

  bodyClasses: ["bg-white"],

  sections: {},

  components: {

    hero: {
      component: "Hero",
      purpose: "Full-viewport hero with background image, headline, optional subheading, and primary CTA.",
      props: {
        hero: {
          purpose: "Hero content object.",
          type: "object",
          required: true,
          guidance: "HeroContent shape: headline, subheading, intro, ctaLabel, ctaUrl, backgroundImageUrl.",
          example: "{ headline: 'Find The Fitness Plan That Fits Your Busy Lifestyle', ... }",
          source: { kind: "pageField", path: "hero" },
        },
      },
    },

    coreValues: {
      component: "CoreValues",
      purpose: "Three value-proposition cards displayed at the base of the hero section. White cards with blue icons.",
      props: {
        items: {
          purpose: "Three value props with icon, headline, and body.",
          type: "object",
          required: false,
          guidance: "Rendered as 3 white cards. Defaults to template content if empty.",
          example: "[]",
          source: { kind: "computed", fn: "valueProps" },
        },
      },
    },

    programs: {
      component: "Programs",
      purpose: "Alternating image+text program sections — one block per featured program.",
      props: {
        headline: {
          purpose: "Section intro text above the programs.",
          type: "string",
          required: false,
          guidance: "Short outcome-focused statement.",
          example: "Every Body Is Unique. Find Something That Works For You",
          source: { kind: "pageField", path: "programsHeadline" },
        },
        slugs: {
          purpose: "List of program slugs to render.",
          type: "object",
          required: true,
          guidance: "Pulls from pages.programs by slug.",
          example: '["bootcamp","personal-training","strength-and-stretch"]',
          source: { kind: "pageField", path: "featuredPrograms" },
        },
      },
    },

    howItWorks: {
      component: "HowItWorks",
      purpose: "3-step getting-started process with numbered circles.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          required: false,
          guidance: "Action-oriented, short.",
          example: "Getting Started Is Easy",
          source: { kind: "pageField", path: "howItWorksHeadline" },
        },
        steps: {
          purpose: "Array of Step objects (number, headline, body).",
          type: "object",
          required: true,
          guidance: "3 steps. Keep each body to one sentence.",
          example: "[]",
          source: { kind: "computed", fn: "howItWorks" },
        },
      },
    },

    testimonials: {
      component: "Testimonials",
      purpose: "Grid of member testimonial cards with star ratings.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          required: false,
          guidance: "References city and trust count if available.",
          example: "Trusted and Loved By Hundreds of Manhattan Residents",
          source: { kind: "pageField", path: "trustHeadline" },
        },
        items: {
          purpose: "Array of Testimonial objects.",
          type: "object",
          required: true,
          guidance: "3-6 testimonials. Render as cards.",
          example: "[]",
          source: { kind: "computed", fn: "testimonials" },
        },
      },
    },

    amenities: {
      component: "Amenities",
      purpose: "6-card grid of gym amenities/features with icons. Dark navy background — a template design element.",
      props: {
        // headline intentionally has no source — component defaults to the template's
        // "Everything You Need To Crush Your Fitness Goals" text, which is a fixed
        // design element of this template (separate from the trust/testimonials headline).
        items: {
          purpose: "Array of Feature objects (icon, label).",
          type: "object",
          required: false,
          guidance: "6 items. Uses emoji as icon fallback.",
          example: "[]",
          source: { kind: "computed", fn: "features" },
        },
      },
    },

    community: {
      component: "Community",
      purpose: "Image + text community section. Photo on left, copy on right.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          required: false,
          guidance: "About belonging and community.",
          example: "A Community That Will Keep You Going",
          source: { kind: "pageField", path: "communityHeadline" },
        },
      },
    },

    location: {
      component: "Location",
      purpose: "Address, hours, and embedded Google Map.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          required: false,
          guidance: "Reference the neighborhood or city.",
          example: "Located in SoHo, Manhattan",
          source: { kind: "slot", section: "location", slot: "headline" },
        },
      },
    },

    faq: {
      component: "FAQ",
      purpose: "Collapsible FAQ accordion.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          required: false,
          guidance: "Welcoming, not intimidating.",
          example: "Questions? We Have the Answers",
          source: { kind: "slot", section: "faq", slot: "headline" },
        },
        items: {
          purpose: "Array of FAQItem objects.",
          type: "object",
          required: true,
          guidance: "8-12 Q&A pairs. Local-search intent questions.",
          example: "[]",
          source: { kind: "computed", fn: "faq" },
        },
      },
    },

    closureBlock: {
      component: "ClosureBlock",
      purpose: "Landing-page conversion closer. Renders the best available closure method (iframe embed → external link → internal CTA). Renders nothing when no closure is configured.",
      props: {
        heading: {
          purpose: "Optional heading above the closure widget.",
          type: "string",
          required: false,
          guidance: "Short, action-oriented. E.g. 'Reserve your spot'.",
          example: "Ready to Drop In?",
          source: { kind: "pageField", path: "hero.ctaLabel" },
        },
        closure: {
          purpose: "The closure configuration — iframe, external URL, or internal CTA.",
          type: "object",
          required: false,
          guidance: "At least one closure method should be configured. All are optional; the component picks the best available.",
          example: "{}",
          source: { kind: "computed", fn: "closure" },
        },
      },
    },

    ctaBand: {
      component: "CTABand",
      purpose: "Dark bottom CTA band — final conversion prompt before the footer.",
      props: {
        headline: {
          purpose: "CTA band headline.",
          type: "string",
          required: false,
          guidance: "Low-friction, outcome-focused.",
          example: "Your fitness journey doesn't have to feel long. Be a member today.",
          source: { kind: "pageField", path: "ctaHeadline" },
        },
        ctaLabel: {
          purpose: "Button label.",
          type: "string",
          required: false,
          guidance: "2-4 words.",
          example: "Book Your Free Intro",
          source: { kind: "pageField", path: "hero.ctaLabel" },
        },
        ctaUrl: {
          purpose: "Button URL.",
          type: "string",
          required: false,
          guidance: "Usually /contact.",
          example: "/contact",
          source: { kind: "pageField", path: "hero.ctaUrl" },
        },
      },
    },

  },

  pages: {

    home: {
      path: "/",
      archetype: "home",
      components: [
        "hero",
        "coreValues",
        "programs",
        "howItWorks",
        "testimonials",
        "amenities",
        "community",
        "location",
        "faq",
        "ctaBand",
      ],
    },

    about: {
      path: "/about",
      archetype: "about",
      components: [
        "hero",
        "community",
        "amenities",
        "location",
        "ctaBand",
      ],
    },

    programIndex: {
      path: "/programs",
      archetype: "programIndex",
      components: [
        "hero",
        "programs",
        "ctaBand",
      ],
    },

    program: {
      path: "/programs/:slug",
      archetype: "program",
      components: [
        "hero",
        "testimonials",
        "location",
        "ctaBand",
      ],
    },

    dropIn: {
      path: "/drop-in",
      archetype: "landingPage",
      // Conversion-only page — no distracting nav links, single goal.
      // closureBlock renders the best available booking method and hides
      // itself when none are configured.
      components: [
        "hero",          // short, punchy — "Drop In Today. $30/class."
        "howItWorks",    // 3 steps: "Pick a class → Show up → Pay on arrival"
        "closureBlock",  // iframe widget | external booking link | internal CTA
        "testimonials",  // remove final hesitation
        "faq",           // address "how does this work?" before they bail
      ],
    },

    contact: {
      path: "/contact",
      archetype: "contact",
      components: [
        "hero",
        "location",
        "faq",
      ],
    },

    pricing: {
      path: "/pricing",
      archetype: "pricing",
      components: [
        "hero",
        "faq",
        "ctaBand",
      ],
    },

    schedule: {
      path: "/schedule",
      archetype: "schedule",
      components: [
        "hero",
      ],
    },

    blog: {
      path: "/blog",
      archetype: "blogIndex",
      components: [
        "hero",
      ],
    },

    legal: {
      path: "/legal",
      archetype: "content",
      components: [
        "hero",
      ],
    },

  },
};
