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

export const faqSectionSpec: SectionSpec = {
  purpose: "10 long-tail FAQ items for any templated page. Used for about, pricing, contact, schedule, content, team, and form pages.",
  count: 10,
  slots: {
    question: {
      purpose: "A question a local searcher would type about this page's topic.",
      type: "string",
      maxWords: 16,
      guidance: "Phrase as a real search query. Bias toward long-tail local intent and the page topic: '[topic] in [city]', '[topic] near [neighborhood]', 'what to expect for [topic] at [gym]', 'is [topic] right for me in [city]'. Use the gym's city and serviceArea neighborhoods naturally. Never invent prices, schedules, or guarantees.",
      example: "What should I bring to my first class at [Gym] in Torrance?",
    },
    answer: {
      purpose: "Honest, useful answer.",
      type: "string",
      maxWords: 55,
      guidance: "Answer directly in 1-3 sentences. Only state documented facts; for unknowns, give general guidance and invite contact. Mention the gym name and city once if natural.",
      example: "Show up in comfortable workout clothes and a water bottle. The coach will walk you through everything else when you arrive.",
    },
  },
};

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

  pageSections: {
    program: {
      hero: {
        purpose: "Program page hero — convert a visitor interested in this specific program into a lead.",
        slots: {
          subheading: {
            purpose: "3-5 word label above the headline. Rendered ALL-CAPS.",
            type: "string",
            maxWords: 5,
            guidance: "Use the gym's city or a program-specific qualifier. Not a full sentence.",
            example: "Group Strength in Torrance",
          },
          headline: {
            purpose: "Main program-page statement — what the visitor gets from this program.",
            type: "string",
            required: true,
            maxWords: 8,
            guidance: "4-8 words. Bold outcome statement for this program. Lead with the member's result. NEVER 'Welcome to [Program]'.",
            example: "Get Stronger. Together.",
          },
          intro: {
            purpose: "1-2 sentence proof point below the headline.",
            type: "string",
            maxWords: 35,
            guidance: "Specific to the program. Reference the format (small group, barbell, interval), coaching, and the gym's city. Avoid clichés. If format details are unknown from the docs, describe generally rather than inventing specifics.",
            example: "Coach-led barbell sessions scaled to every level. Build strength that carries over to everything you do.",
          },
          ctaLabel: {
            purpose: "Primary CTA button text for this program page.",
            type: "string",
            maxWords: 4,
            guidance: "2-4 words. Action-oriented. Options: 'Try It Free', 'Book a Class', 'Claim Your Spot', 'Start Free Trial'.",
            example: "Try It Free",
          },
          ctaUrl: {
            purpose: "Destination URL for the primary CTA.",
            type: "string",
            guidance: "Use '/contact' if no specific booking URL is documented.",
            example: "/contact",
          },
        },
      },

      whatIsIt: {
        purpose: "Explain the program in plain language so a first-time visitor understands what it is.",
        slots: {
          headline: {
            purpose: "Section heading.",
            type: "string",
            maxWords: 6,
            guidance: "4-6 words. Pose the question the section answers. e.g. 'What is group strength training?'",
            example: "What is group strength training?",
          },
          body: {
            purpose: "2-3 sentences describing the program.",
            type: "string",
            maxWords: 80,
            guidance: "Describe the format, who leads it, and the outcome. Only use specific facts found in the gym docs or extracted page content (class times, durations, prices, coach names). If those details are unknown, describe the program in general terms and invite the visitor to ask. Never invent hours, prices, schedules, or guarantees.",
            example: "A coach-led small-group class built around barbell and functional strength. Sessions are scaled to your level so you progress safely alongside other members.",
          },
        },
      },

      whatMakesUsDifferent: {
        purpose: "Three specific differentiators that make this program the right choice at this gym.",
        count: 3,
        slots: {
          item: {
            purpose: "One differentiator sentence.",
            type: "string",
            maxWords: 16,
            guidance: "8-16 words. Specific to this gym's coaching, community, or approach. Do not invent facts. If the docs don't support three distinct differentiators, write fewer by leaving later items empty, or use general but honest claims based on the gym's identity.",
            example: "Coaches scale every lift to your level — no guesswork, no intimidation.",
          },
        },
      },

      whatToExpect: {
        purpose: "Three concrete expectations for a first visit so the visitor feels prepared.",
        count: 3,
        slots: {
          step: {
            purpose: "One expectation sentence.",
            type: "string",
            maxWords: 16,
            guidance: "8-16 words. Walk through arrival → warm-up → workout. Only mention specific times/durations if documented. Otherwise use general language like 'a structured warm-up', 'a coached workout', and 'time to cool down and ask questions'.",
            example: "Show up a few minutes early to meet your coach and settle in.",
          },
        },
      },

      whoIsItFor: {
        purpose: "Three audience qualifiers so the right visitor self-selects.",
        count: 3,
        slots: {
          item: {
            purpose: "One audience description sentence.",
            type: "string",
            maxWords: 14,
            guidance: "6-14 words. Describe the person, not just a trait. e.g. 'Beginners who have never touched a barbell', 'Busy parents who need efficient training', 'Athletes ready to build raw strength'.",
            example: "Beginners who want a safe place to learn the barbell.",
          },
        },
      },

      gettingStarted: {
        purpose: "Three low-friction steps to begin the program.",
        count: 3,
        slots: {
          headline: {
            purpose: "Step name.",
            type: "string",
            maxWords: 5,
            guidance: "2-5 words. Logical journey: book → meet → train.",
            example: "Book your first class",
          },
          body: {
            purpose: "One sentence making this step easy.",
            type: "string",
            maxWords: 22,
            guidance: "12-20 words. Reduce anxiety. Avoid invented specifics. e.g. 'Pick a time that works for you and reserve your spot online or at the front desk.'",
            example: "Pick a time online and reserve your first session.",
          },
        },
      },

      faq: {
        purpose: "10 long-tail, local-search FAQ items unique to this program page. Drives SEO, GEO, AEO, and local SEO.",
        count: 10,
        slots: {
          question: {
            purpose: "A question someone in the gym's area would actually type into Google.",
            type: "string",
            maxWords: 16,
            guidance: "Phrase as a real search query. Bias toward long-tail local intent: '[program] near me in [city]', 'what to expect at [program] in [city]', 'is [program] good for beginners in [city]', 'how much does [program] cost in [city]', '[program] vs CrossFit in [city]'. Use nearby neighborhoods from serviceArea when natural. Never invent prices, schedules, or guarantees.",
            example: "Where can I try strength classes near me in Torrance?",
          },
          answer: {
            purpose: "Honest, useful answer to the question.",
            type: "string",
            maxWords: 55,
            guidance: "Answer directly in 1-3 sentences. Use only documented facts; for unknown specifics, describe the general experience and invite the visitor to contact the gym. Include the gym name and city naturally once, without keyword stuffing.",
            example: "[Gym] in Torrance offers coach-led strength classes built around barbell and functional movements. Every session is scaled to your level, so you can walk in on day one and train safely.",
          },
        },
      },
    },

    about: {
      hero: {
        purpose: "Earn trust immediately by telling the visitor who the gym is and why they should care.",
        slots: {
          subheading: {
            purpose: "3-5 word label above the headline. Rendered ALL-CAPS.",
            type: "string",
            maxWords: 5,
            guidance: "Use the city, neighborhood, or a trust signal. Not a full sentence.",
            example: "Our Story in Torrance",
          },
          headline: {
            purpose: "Main about-page statement that frames the gym's identity.",
            type: "string",
            required: true,
            maxWords: 8,
            guidance: "4-8 words. Lead with the gym name or the human story. Avoid generic 'Welcome to ...'.",
            example: "Built Around People, Not Machines",
          },
          intro: {
            purpose: "1-2 sentence proof point below the headline.",
            type: "string",
            maxWords: 35,
            guidance: "Specific: years in business, founding story, or community impact. Avoid clichés like 'state of the art' or 'world class'.",
            example: "Since 2018, [Gym] has helped Torrance neighbors build strength and confidence side by side.",
          },
          ctaLabel: {
            purpose: "Primary CTA button text for this about page.",
            type: "string",
            maxWords: 4,
            guidance: "2-4 words. Action-oriented. Options: 'Book a Free Tour', 'Meet the Coaches', 'Start Your Trial'.",
            example: "Book a Free Tour",
          },
          ctaUrl: {
            purpose: "Destination URL for the primary CTA.",
            type: "string",
            guidance: "Use '/contact' if no specific booking URL is available.",
            example: "/contact",
          },
        },
      },

      story: {
        purpose: "Founder or origin story that answers why this gym exists.",
        slots: {
          headline: {
            purpose: "Story section heading.",
            type: "string",
            maxWords: 8,
            guidance: "4-8 words. Name the story, e.g. 'How [Gym] Started', 'The Story Behind [Gym]'.",
            example: "How [Gym] Started",
          },
          subheadline: {
            purpose: "Optional one-line summary below the headline.",
            type: "string",
            maxWords: 18,
            guidance: "1 sentence that sets up the story.",
            example: "Two coaches, one empty warehouse, and a belief that fitness should be accessible.",
          },
          imageUrl: {
            purpose: "Photo of founders, original location, or team.",
            type: "string",
            guidance: "Use a real image URL from the captured assets, or leave empty if no suitable photo exists.",
            example: "/_assets/founders.webp",
          },
          imageAlt: {
            purpose: "Accessible alt text for the story image.",
            type: "string",
            guidance: "Describe the image content.",
            example: "Founders of [Gym] in front of the original gym space",
          },
          blocks: {
            purpose: "Rich-text blocks telling the story.",
            type: "object",
            guidance: "Return an array of { type, html } objects. Use type 'text' for paragraphs. Only use verified facts from the docs; if founding details are unknown, write general but honest copy and invite the visitor to ask.",
            example: "[{ type: 'text', html: '<p>We opened [Gym] because...</p>' }]",
          },
        },
      },

      community: {
        purpose: "Emotional community section describing what it feels like to train here.",
        slots: {
          headline: {
            purpose: "Community section heading.",
            type: "string",
            maxWords: 8,
            guidance: "4-8 words. Focus on belonging and people.",
            example: "A Community That Keeps You Going",
          },
          body: {
            purpose: "Long-form HTML body for the community section.",
            type: "string",
            maxWords: 120,
            guidance: "2-4 paragraphs. Specific to this gym's culture. Avoid generic gym clichés. Use the gym name and city at most once each.",
            example: "<p>At [Gym], the workout is only part of the draw...</p>",
          },
        },
      },

      team: {
        purpose: "Introduce the coaching staff so visitors feel safe investing in training.",
        slots: {
          headline: {
            purpose: "Team section heading.",
            type: "string",
            maxWords: 8,
            guidance: "4-8 words. e.g. 'Meet Your Coaches', 'The People Behind [Gym]'.",
            example: "Meet Your Coaches",
          },
          members: {
            purpose: "Array of team members.",
            type: "object",
            guidance: "Return an array of { name, title, photoUrl, bio? }. Only include coaches/owners documented in the gym docs. Do not invent people. photoUrl should be a real captured image path or empty.",
            example: "[{ name: 'Alex Reed', title: 'Head Coach', photoUrl: '/_assets/coach-alex.webp', bio: '10 years coaching strength and conditioning in Torrance.' }]",
          },
        },
      },

      testimonials: {
        purpose: "Real member testimonials that build trust.",
        slots: {
          headline: {
            purpose: "Social-proof banner headline.",
            type: "string",
            maxWords: 10,
            guidance: "5-10 words. Quantify if possible.",
            example: "Trusted by 500+ Members in Torrance",
          },
          items: {
            purpose: "Member testimonial objects.",
            type: "object",
            guidance: "Return an array of { quote, name }. Use only real testimonials from the extracted website content. Never invent names or quotes.",
            example: "[{ quote: '...', name: 'Jamie' }]",
          },
        },
      },

      ctaBand: {
        purpose: "Final call-to-action band on the about page.",
        slots: {
          headline: {
            purpose: "Bottom CTA headline.",
            type: "string",
            required: true,
            maxWords: 8,
            guidance: "4-8 words. Action-oriented. e.g. 'Come See What Makes Us Different'.",
            example: "Come See What Makes Us Different",
          },
          ctaLabel: {
            purpose: "CTA button text.",
            type: "string",
            maxWords: 4,
            guidance: "2-4 words. Action-oriented.",
            example: "Book a Tour",
          },
          ctaUrl: {
            purpose: "CTA destination URL.",
            type: "string",
            guidance: "Use '/contact' if unknown.",
            example: "/contact",
          },
        },
      },

      faq: faqSectionSpec,

      location: {
        purpose: "Location context for the about page.",
        slots: {
          headline: {
            purpose: "Location section heading.",
            type: "string",
            maxWords: 8,
            guidance: "4-8 words. e.g. 'Find Us in [City]'.",
            example: "Find Us in Torrance",
          },
          body: {
            purpose: "Location description.",
            type: "string",
            maxWords: 40,
            guidance: "1-2 sentences. Reference the neighborhood or address if known.",
            example: "We are located in Torrance, easy to reach from...",
          },
        },
      },
    },

    faq: { faq: faqSectionSpec },
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

    whatIsIt: {
      component: "WhatIsIt",
      purpose: "Two-column program description block: section headline + explanatory body.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          maxWords: 6,
          guidance: "Rendered as the section heading.",
          example: "What is group strength training?",
          source: { kind: "pageField", path: "whatIsIt.headline" },
        },
        body: {
          purpose: "2-3 sentence description of the program or topic.",
          type: "string",
          maxWords: 80,
          guidance: "Rendered as body copy.",
          example: "A coach-led small-group class built around barbell and functional strength...",
          source: { kind: "pageField", path: "whatIsIt.body" },
        },
      },
    },

    whatToExpect: {
      component: "WhatToExpect",
      purpose: "Numbered expectation chips for a program page.",
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          maxWords: 6,
          guidance: "Rendered above the expectation chips.",
          example: "What to expect",
          source: { kind: "pageField", path: "whatToExpect.headline" },
        },
        steps: {
          purpose: "Expectation sentences.",
          type: "string[]",
          required: true,
          guidance: "Rendered as numbered chips.",
          example: "[\"Show up a few minutes early\", \"A structured warm-up\", \"A coached workout\"]",
          source: { kind: "pageField", path: "whatToExpect.steps" },
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
          source: { kind: "pageField", path: "programsHeadline" },
        },
        subheadline: {
          purpose: "Short supporting line below the headline.",
          type: "string",
          maxWords: 10,
          guidance: "Sets the emotional frame for the program grid.",
          example: "Find a fitness routine that works for you",
          source: { kind: "pageField", path: "programsSubheadline" },
        },
        slugs: {
          purpose: "Program slugs to render in the grid.",
          type: "string[]",
          required: true,
          guidance: "Array of program slugs from GymSiteContent.pages.programs.",
          example: "[fundamentals, strength, nutrition]",
          source: { kind: "pageField", path: "featuredPrograms" },
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
        headline: {
          purpose: "Section headline shown above the three benefit cards.",
          type: "string",
          maxWords: 6,
          guidance: "4-6 words. Provides an h2 for accessibility heading order. Defaults to a generic benefit framing.",
          example: "Why train with us",
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
      purpose: "Emotional community section with text and optional image. Renders value-prop items when available, otherwise a long-form body.",
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
        body: {
          purpose: "Long-form HTML body rendered when items are not provided. Used by the about-page archetype for the gym story.",
          type: "string",
          guidance: "Sanitized HTML. Falls back to items or generic placeholder copy.",
          example: "<p>Your Gym Name started in 2018 when...</p>",
          source: { kind: "pageField", path: "communityBody" },
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

    pricingGrid: {
      component: "PricingGrid",
      purpose: "Membership / pricing plan cards.",
      props: {
        grid: {
          purpose: "Pricing grid object with plans array.",
          type: "object",
          required: true,
          guidance: "Rendered from pages.pricing.grid.",
          example: "{ headline: 'Memberships', plans: [...] }",
          source: { kind: "field", path: "pages.pricing.grid" },
        },
      },
    },

    blogGrid: {
      component: "BlogGrid",
      purpose: "Blog post card grid.",
      props: {
        posts: {
          purpose: "Array of blog posts.",
          type: "object",
          required: true,
          guidance: "Rendered from pages.blog.posts.",
          example: "[{ slug, title, excerpt }...]",
          source: { kind: "field", path: "pages.blog.posts" },
        },
        headline: {
          purpose: "Optional headline override.",
          type: "string",
          maxWords: 8,
          guidance: "Rendered above the grid. Defaults to 'Latest posts' if not provided.",
          example: "Latest from the blog",
        },
      },
    },

    richContent: {
      component: "RichContent",
      purpose: "Generic long-form content block for pillar, legal, local-guide, and HSA/FSA pages.",
      props: {
        sections: {
          purpose: "Rich content sections.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's richContent or sections.",
          example: "[{ headline, blocks: [...] }]",
          source: { kind: "pageField", path: "richContent" },
        },
      },
    },

    story: {
      component: "Story",
      purpose: "Generic photo + rich-text narrative section for founder story, background story, or any page needing an image with long-form blocks.",
      conditional: true,
      props: {
        headline: {
          purpose: "Section headline.",
          type: "string",
          maxWords: 8,
          guidance: "4-8 words. Name the story, e.g. 'How [Gym] Started', 'The Story Behind [Gym]', 'Built in [City]'.",
          example: "How Your Gym Name Started",
          source: { kind: "pageField", path: "story.headline" },
        },
        subheadline: {
          purpose: "Optional one-line summary below the headline.",
          type: "string",
          maxWords: 18,
          guidance: "1 sentence that sets up the story.",
          example: "Two coaches, one empty warehouse, and a belief that fitness should be accessible.",
          source: { kind: "pageField", path: "story.subheadline" },
        },
        imageUrl: {
          purpose: "Optional photo of founders, original location, or team.",
          type: "string",
          guidance: "Leave empty to render text only.",
          example: "/assets/beanburito/founders.webp",
          source: { kind: "pageField", path: "story.imageUrl" },
        },
        imageAlt: {
          purpose: "Accessible alt text for the story image.",
          type: "string",
          guidance: "Describe the image content.",
          example: "Founders of Your Gym Name in front of the original gym space",
          source: { kind: "pageField", path: "story.imageAlt" },
        },
        blocks: {
          purpose: "Rich-text blocks telling the story.",
          type: "object",
          guidance: "Rendered as paragraphs, callouts, images, etc.",
          example: "[{ type: 'text', html: '...' }]",
          source: { kind: "pageField", path: "story.blocks" },
        },
      },
    },

    team: {
      component: "teamBeanburito",
      purpose: "Coach / team member grid (beanburito dark skewed band).",
      props: {
        team: {
          purpose: "Array of team members.",
          type: "object",
          required: true,
          guidance: "Rendered from the current page's team, falling back to pages.about.team.",
          example: "[{ name, title, photoUrl, bio }...]",
          source: { kind: "pageField", path: "team" },
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
      archetype: "home",
      goal: "Convert a first-time visitor into a lead within three seconds by stating the gym's core promise and driving the primary offer.",
      idealAction: "Start a free trial or book a tour",
      visitorStage: "awareness",
      searchIntent: "local",
      objectionsToOvercome: ["Is this gym right for me?", "Will I fit in?", "Is it worth the commute?"],
      evidenceTypes: ["member testimonials", "years in business", "coach credentials", "GMB rating"],
      seoPrimaryQuery: "[gym type] in [city]",
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
    program: {
      path: "/programs/:slug",
      archetype: "program",
      goal: "Help a visitor decide that this specific program is the right fit for their goals and lower the barrier to trying it.",
      idealAction: "Book a free class or trial",
      visitorStage: "consideration",
      searchIntent: "transactional",
      objectionsToOvercome: ["Is this program too hard for me?", "What actually happens in class?", "How is this different from other gyms?"],
      evidenceTypes: ["program description", "what to expect steps", "testimonials from this program", "coach credentials"],
      seoPrimaryQuery: "[program name] classes in [city]",
      components: ["hero", "whatIsIt", "whatToExpect", "faq", "testimonials", "ctaBand"],
    },
    programIndex: {
      path: "/programs",
      archetype: "programIndex",
      goal: "Show the full range of programs so the visitor can self-select the one that matches their goal.",
      idealAction: "Pick a program and start a free trial",
      visitorStage: "consideration",
      searchIntent: "informational",
      objectionsToOvercome: ["Which program should I choose?", "Do they have what I need?"],
      evidenceTypes: ["program descriptions", "program cover images"],
      seoPrimaryQuery: "fitness programs in [city]",
      components: ["hero", "programs", "ctaBand"],
    },
    about: {
      path: "/about",
      archetype: "about",
      goal: "Earn trust by telling the gym's origin story, introducing the coaching team, and proving community impact. Primary conversion: book a free intro or visit.",
      idealAction: "Book a free intro or visit",
      visitorStage: "consideration",
      searchIntent: "informational",
      objectionsToOvercome: ["Can I trust these coaches?", "Does this gym actually care about members?", "Why was this gym started?"],
      evidenceTypes: ["founder story", "years in business", "coach bios and photos", "member testimonials", "community ethos"],
      seoPrimaryQuery: "about [gym name] in [city]",
      contentSignals: [
        "founderStory",
        "yearsInBusiness",
        "whyThisGymExists",
        "communityEthos",
        "teamMembers",
        "teamPhotos",
      ],
      requiredFields: [
        "pages.about.hero.headline",
        "pages.about.story.blocks",
        "pages.about.story.imageUrl",
        "pages.about.team",
        "pages.about.ctaHeadline",
        "pages.about.faq",
      ],
      placeholderPolicy: "block-publish",
      components: ["hero", "story", "community", "team", "testimonials", "faq", "ctaBand", "location"],
    },
    contact: {
      path: "/contact",
      archetype: "contact",
      goal: "Make it effortless for a visitor to reach out or visit, and remove any friction from the first contact.",
      idealAction: "Call, message, or submit a form",
      visitorStage: "conversion",
      searchIntent: "navigational",
      objectionsToOvercome: ["Will someone actually respond?", "When are they open?", "Where exactly are they located?"],
      evidenceTypes: ["address", "hours", "map", "phone", "response promise"],
      seoPrimaryQuery: "[gym name] contact [city]",
      components: ["hero", "location", "faq", "iframeBand", "ctaBand"],
    },
    pricing: {
      path: "/pricing",
      archetype: "pricing",
      goal: "Present membership options clearly and move the visitor toward a conversation rather than a price-only decision.",
      idealAction: "Book a tour or free intro",
      visitorStage: "consideration",
      searchIntent: "transactional",
      objectionsToOvercome: ["Is it worth the cost?", "Are there hidden fees?", "Which plan is right for me?"],
      evidenceTypes: ["plan features", "testimonials", "coach credentials", "value props"],
      seoPrimaryQuery: "gym membership cost in [city]",
      components: ["hero", "pricingGrid", "faq", "ctaBand"],
    },
    schedule: {
      path: "/schedule",
      archetype: "schedule",
      goal: "Help a visitor see that classes fit their weekly routine and drive them to reserve or book a visit.",
      idealAction: "Reserve a class or book a tour",
      visitorStage: "conversion",
      searchIntent: "transactional",
      objectionsToOvercome: ["Do classes fit my schedule?", "Can beginners join?", "Do I need to reserve?"],
      evidenceTypes: ["live schedule", "class descriptions", "location"],
      seoPrimaryQuery: "[gym name] class schedule [city]",
      components: ["hero", "iframeBand", "ctaBand", "location"],
    },
    blogIndex: {
      path: "/blog",
      archetype: "blogIndex",
      goal: "Demonstrate expertise, capture long-tail local search traffic, and move readers toward a low-friction next step.",
      idealAction: "Read a relevant article or book a free intro",
      visitorStage: "awareness",
      searchIntent: "informational",
      objectionsToOvercome: ["Does this gym know what they're talking about?", "Is the content relevant to me?"],
      evidenceTypes: ["local fitness expertise", "long-tail local topics"],
      seoPrimaryQuery: "fitness tips [city]",
      components: ["hero", "blogGrid", "ctaBand"],
    },
    localGuide: {
      path: "/local-guide",
      archetype: "content",
      goal: "Win local search intent by answering a specific fitness-related question for the area and convert the reader into a lead.",
      idealAction: "Book a free intro or visit",
      visitorStage: "awareness",
      searchIntent: "local",
      objectionsToOvercome: ["Is this gym actually local?", "Do they understand my neighborhood?"],
      evidenceTypes: ["local knowledge", "service area", "testimonials"],
      seoPrimaryQuery: "[fitness topic] in [city]",
      components: ["hero", "richContent", "faq", "ctaBand"],
    },
    team: {
      path: "/coaches",
      archetype: "team",
      goal: "Build confidence in the coaching staff so a visitor feels safe investing time and money in training.",
      idealAction: "Book a free intro with a coach",
      visitorStage: "consideration",
      searchIntent: "informational",
      objectionsToOvercome: ["Are the coaches qualified?", "Will they pay attention to me?", "Do they have experience with people like me?"],
      evidenceTypes: ["coach bios", "credentials", "photos", "testimonials about coaching"],
      seoPrimaryQuery: "personal trainers [city]",
      components: ["hero", "team", "ctaBand"],
    },
    form: {
      path: "/request",
      archetype: "form",
      goal: "Capture lead information with minimal friction and set clear expectations about what happens next.",
      idealAction: "Complete the form",
      visitorStage: "conversion",
      searchIntent: "transactional",
      objectionsToOvercome: ["Will I get spammed?", "What happens after I submit?", "How long until someone responds?"],
      evidenceTypes: ["response promise", "offer", "trust headline"],
      seoPrimaryQuery: "free trial [gym name] [city]",
      components: ["hero", "iframeBand", "ctaBand"],
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

/** Build the section-by-section prompt for a specific page type (e.g. "program"). */
export function buildPageSpecPrompt(spec: TemplateSpec, pageKey: string): string {
  const pageSections = spec.pageSections?.[pageKey];
  const page = spec.pages[pageKey];
  if (!pageSections && !page) return "";

  const lines: string[] = [
    `TEMPLATE PAGE TYPE: ${pageKey.toUpperCase()} (${spec.name})`,
    `STYLE: ${spec.description}`,
  ];

  if (page?.goal) {
    lines.push(`PAGE GOAL: ${page.goal}`);
  }
  if (page?.idealAction) {
    lines.push(`IDEAL ACTION: ${page.idealAction}`);
  }
  if (page?.visitorStage) {
    lines.push(`VISITOR STAGE: ${page.visitorStage}`);
  }
  if (page?.searchIntent) {
    lines.push(`SEARCH INTENT: ${page.searchIntent}`);
  }
  if (page?.objectionsToOvercome?.length) {
    lines.push(`OBJECTIONS TO OVERCOME: ${page.objectionsToOvercome.join("; ")}`);
  }
  if (page?.evidenceTypes?.length) {
    lines.push(`EVIDENCE TO USE: ${page.evidenceTypes.join(", ")}`);
  }
  if (page?.seoPrimaryQuery) {
    lines.push(`SEO PRIMARY QUERY: ${page.seoPrimaryQuery}`);
  }
  if (page?.contentSignals?.length) {
    lines.push(`CONTENT SIGNALS TO EXTRACT OR WRITE: ${page.contentSignals.join(", ")}`);
  }

  lines.push(
    "",
    `Fill each section below using the gym's real information from the context above.`,
    `Follow each spec's guidance exactly — purpose, word count, tone.`,
    `Every section must support the PAGE GOAL and drive the IDEAL ACTION.`,
    "",
  );

  if (pageSections) {
    for (const [sectionKey, section] of Object.entries(pageSections)) {
      lines.push(`=== SECTION: ${sectionKey.toUpperCase()} ===`);
      lines.push(`Purpose: ${section.purpose}`);
      if (section.count) lines.push(`Count: exactly ${section.count} items`);
      lines.push(``);

      for (const [slotKey, slot] of Object.entries(section.slots)) {
        lines.push(`  ${slotKey}:`);
        lines.push(`    Purpose: ${slot.purpose}`);
        if (slot.maxWords) lines.push(`    Max words: ${slot.maxWords}`);
        if (slot.type === "string[]") lines.push(`    Type: array of strings`);
        lines.push(`    Guidance: ${slot.guidance}`);
        lines.push(`    Example: "${slot.example}"`);
        lines.push(``);
      }
    }
  }

  return lines.join("\n");
}
