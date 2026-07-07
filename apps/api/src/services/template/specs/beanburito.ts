/**
 * Beanburito template content spec.
 *
 * Every slot the beanburito homepage needs, with purpose, constraints, and
 * guidance so the LLM knows exactly what to write — not just "fill a headline"
 * but "write a 4-8 word outcome statement that leads with the member's result."
 *
 * This spec drives the generate stage prompt. When the template changes, update
 * the spec and re-run the generate stage.
 */

export interface SlotSpec {
  purpose: string;
  type: "string" | "number";
  required?: boolean;
  maxWords?: number;
  guidance: string;
  example: string;
}

export interface SectionSpec {
  purpose: string;
  count?: number;          // for array sections: how many items
  slots: Record<string, SlotSpec>;
}

export interface TemplateSpec {
  name: string;
  description: string;
  sections: Record<string, SectionSpec>;
}

export const beanburitoSpec: TemplateSpec = {
  name: "beanburito",
  description: "Dark, bold, community-focused gym template. Large typography, high contrast, testimonials-first social proof.",

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
          maxWords: 28,
          guidance: "15-25 words. Concrete and specific. Name the type of person this serves if possible. Connect to the gym's identity from the docs.",
          example: "Whether you've never touched a barbell or trained for years, our coaches scale every workout to where you are today.",
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
      purpose: "Short social-proof banner headline shown above testimonials.",
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
