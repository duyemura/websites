import type { GymSiteContent } from "@milo/shared-types";
import type { SynthesizeArtifact } from "../../types/pipeline-artifacts";

/**
 * Returns true for component tags that need richer placeholder content to render
 * meaningfully during eval builds.
 */
function needsRichContent(tag: string): boolean {
  return [
    "hero",
    "feature-grid",
    "testimonial-band",
    "social-proof-band",
    "steps-band",
    "faq-block",
    "team",
  ].includes(tag);
}

/**
 * Builds a minimal GymSiteContent fixture from synthesized template metadata.
 * Used exclusively for component-eval builds — fills required slots with
 * placeholder text so the Astro template renders without errors. Sections that
 * were not detected in the synthesize artifact receive empty arrays / stubs
 * instead of hardcoded mock data.
 */
export function buildFixture(synthesize: SynthesizeArtifact): GymSiteContent {
  const gymName = "Placeholder Gym";
  const city = "Springfield";
  const stateAbbr = "CA";

  // Build a quick lookup of detected tags for O(1) checks below.
  const detectedTags = new Set(
    (synthesize.components ?? []).map((c) => c.tag as string),
  );

  const hasTag = (tag: string): boolean => detectedTags.has(tag);

  const hero = {
    headline: "Placeholder headline",
    subheading: "Placeholder subheading for the eval build.",
    ctaLabel: "Get started",
    ctaUrl: "/contact",
  };

  const valueProp = (n: number) => ({
    icon: "🏋️",
    headline: `Value prop ${n}`,
    body: `Short description for value prop ${n}.`,
  });

  const faqItem = (n: number) => ({
    question: `Placeholder question ${n}?`,
    answer: `Placeholder answer ${n}.`,
  });

  const testimonial = {
    quote: "This gym changed my life.",
    name: "Jane Doe",
    program: "General",
  };

  const step = (n: number) => ({
    number: n,
    headline: `Step ${n}`,
    body: `Description for step ${n}.`,
  });

  const feature = (n: number) => ({
    icon: "⚡",
    label: `Feature ${n}`,
  });

  const legalBlock = { type: "text" as const, html: "<p>Placeholder legal content.</p>" };

  // --- Component-aware section decisions ---

  // Programs: only include mock data if a feature-grid or program-cards-sticky was detected.
  const hasProgramSection =
    hasTag("feature-grid") || hasTag("program-cards-sticky");

  // Use 3 programs when program-cards-sticky is detected — fills a 3-column card grid.
  const featuredPrograms = hasProgramSection
    ? ["group-fitness", "personal-training", "open-gym"]
    : [];

  const programPages: GymSiteContent["pages"]["programs"] = hasProgramSection
    ? [
        {
          slug: "group-fitness",
          name: "Group fitness",
          shortDescription: "Coach-led group classes for all levels.",
          coverImageUrl: "__NO_IMAGE__",
          hero: { ...hero, headline: "Group fitness" },
          whatIsIt: {
            headline: "What is group fitness?",
            body: "High-energy classes led by expert coaches.",
          },
          whatMakesUsDifferent: ["Expert coaches", "Small class sizes", "Supportive community"],
          whatToExpect: {
            headline: "What to expect",
            steps: ["Book your first class", "Meet your coach", "Start training"],
          },
          whoIsItFor: ["Beginners", "Intermediate athletes", "Advanced athletes"],
          gettingStarted: [step(1), step(2), step(3)],
          testimonials: hasTag("testimonial-band") ? [testimonial] : [],
          faq: hasTag("faq-block") ? [faqItem(1), faqItem(2)] : [],
        },
        {
          slug: "personal-training",
          name: "Personal training",
          shortDescription: "One-on-one coaching tailored to your goals.",
          coverImageUrl: "__NO_IMAGE__",
          hero: { ...hero, headline: "Personal training" },
          whatIsIt: {
            headline: "What is personal training?",
            body: "Dedicated 1:1 sessions with a certified coach.",
          },
          whatMakesUsDifferent: ["Custom programming", "Flexible scheduling", "Accountability"],
          whatToExpect: {
            headline: "What to expect",
            steps: ["Assessment session", "Custom program built", "Train and progress"],
          },
          whoIsItFor: ["Anyone with specific goals", "People returning from injury", "Athletes"],
          gettingStarted: [step(1), step(2), step(3)],
          testimonials: hasTag("testimonial-band") ? [testimonial] : [],
          faq: hasTag("faq-block") ? [faqItem(1), faqItem(2)] : [],
        },
        {
          slug: "open-gym",
          name: "Open gym",
          shortDescription: "Train on your own schedule with full equipment access.",
          coverImageUrl: "__NO_IMAGE__",
          hero: { ...hero, headline: "Open gym" },
          whatIsIt: {
            headline: "What is open gym?",
            body: "Unlimited access to all equipment and facilities.",
          },
          whatMakesUsDifferent: ["Flexible hours", "Full equipment access", "Expert staff on site"],
          whatToExpect: {
            headline: "What to expect",
            steps: ["Choose your time", "Access the floor", "Train at your pace"],
          },
          whoIsItFor: ["Self-directed athletes", "Members with a plan", "Anyone who wants flexibility"],
          gettingStarted: [step(1), step(2), step(3)],
          testimonials: hasTag("testimonial-band") ? [testimonial] : [],
          faq: hasTag("faq-block") ? [faqItem(1), faqItem(2)] : [],
        },
      ]
    : [];

  // Testimonials: only include mock data if a testimonial-band was detected.
  const homeTestimonials = hasTag("testimonial-band") ? [testimonial] : [];

  // FAQ: only include mock items if a faq-block was detected.
  const homeFaq = hasTag("faq-block") ? [faqItem(1), faqItem(2)] : [];

  // Features (feature-grid): only include mock items if detected.
  const homeFeatures = hasTag("feature-grid")
    ? [feature(1), feature(2), feature(3), feature(4)]
    : [];

  // Schedule iframe: only include if an iframe component was detected.
  const scheduleIframes = hasTag("iframe")
    ? [{ src: "https://placeholder.example.com/schedule", variant: "schedule", title: "Class schedule" }]
    : undefined;

  // Team/coaches: richer placeholders if a team component was detected.
  const aboutTeam: GymSiteContent["pages"]["about"]["team"] = hasTag("team")
    ? [
        {
          name: "Coach Alex",
          title: "Head coach",
          photoUrl: "__NO_IMAGE__",
          bio: "10 years coaching experience.",
        },
        {
          name: "Coach Jordan",
          title: "Strength coach",
          photoUrl: "__NO_IMAGE__",
          bio: "Former collegiate athlete.",
        },
      ]
    : [
        {
          name: "Coach Alex",
          title: "Head coach",
          photoUrl: "__NO_IMAGE__",
          bio: "10 years of coaching experience.",
        },
      ];

  // About-page testimonials: optional field, only populate if testimonial-band detected.
  const aboutTestimonials = hasTag("testimonial-band") ? [testimonial] : undefined;

  // About-page FAQ: optional field, only populate if faq-block detected.
  const aboutFaq = hasTag("faq-block") ? [faqItem(1), faqItem(2)] : undefined;

  void needsRichContent; // exported for future callers; silence unused-var lint

  const fixture: GymSiteContent = {
    meta: {
      siteId: "00000000-0000-0000-0000-000000000000",
      apiBaseUrl: "https://api.example.com",
      siteUrl: "https://placeholder-gym.example.com",
      defaultTitle: `${gymName} | ${city}, ${stateAbbr}`,
      defaultDescription: `${gymName} offers coach-led training in ${city}, ${stateAbbr}.`,
      preview: true,
      templateTheme: synthesize.templateName as GymSiteContent["meta"]["templateTheme"] ?? "baseline",
    },

    business: {
      name: gymName,
      tagline: `${gymName} is a coach-led gym in ${city}, ${stateAbbr}.`,
      address: { street: "123 Main St", city, state: "California", zip: "90210" },
      phone: "(555) 555-5555",
      hours: [
        { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "06:00", closes: "20:00" },
        { days: ["Saturday", "Sunday"], opens: "08:00", closes: "12:00" },
      ],
      primaryCta: { label: "Book a free intro", url: "/contact" },
      geo: { city, state: "California", stateAbbr },
    },

    brand: {
      primaryColor: "#1a1a1a",
      secondaryColor: "#ffffff",
      accentColor: "#0066ff",
      headingFont: "Inter",
      bodyFont: "Inter",
      logoUrl: "__NO_IMAGE__",
      logoAlt: gymName,
    },

    navigation: {
      header: [
        { label: "Programs", href: "/programs" },
        { label: "Schedule", href: "/schedule" },
        { label: "Pricing", href: "/pricing" },
        { label: "About", href: "/about" },
        { label: "Contact", href: "/contact" },
      ],
      footer: [
        {
          label: "Quick links",
          links: [
            { label: "Programs", href: "/programs" },
            { label: "Pricing", href: "/pricing" },
            { label: "Contact", href: "/contact" },
          ],
        },
        {
          label: "Legal",
          links: [
            { label: "Privacy policy", href: "/legal/privacy-policy" },
            { label: "Terms of use", href: "/legal/terms-of-use" },
          ],
        },
      ],
    },

    pages: {
      home: {
        hero,
        valueProps: [valueProp(1), valueProp(2), valueProp(3)],
        programsHeadline: "Our programs",
        featuredPrograms,
        features: homeFeatures,
        communityHeadline: "A community that keeps you going",
        communityProps: [valueProp(1), valueProp(2), valueProp(3)],
        trustHeadline: "Join hundreds of members",
        howItWorksHeadline: "How it works",
        howItWorks: hasTag("steps-band") ? [step(1), step(2), step(3)] : [],
        testimonials: homeTestimonials,
        faq: homeFaq,
        ...(scheduleIframes !== undefined && { iframes: scheduleIframes }),
      },

      programs: programPages,

      about: {
        hero: { ...hero, headline: "About us" },
        gymStory: "We started this gym because we believe everyone deserves great coaching.",
        team: aboutTeam,
        ...(aboutTestimonials !== undefined && { testimonials: aboutTestimonials }),
        ...(aboutFaq !== undefined && { faq: aboutFaq }),
      },

      pricing: {
        hero: { ...hero, headline: "Pricing" },
        grid: {
          headline: "Simple, transparent pricing",
          plans: [
            {
              name: "Starter",
              price: "$99",
              period: "per month",
              description: "Perfect for beginners.",
              features: ["Unlimited classes", "Coach support", "Community access"],
              cta: { label: "Get started", url: "/contact" },
            },
          ],
        },
      },

      contact: {
        hero: { ...hero, headline: "Contact us" },
        intro: "We'd love to hear from you. Reach out anytime.",
        ...(homeFaq.length > 0 && { faq: homeFaq }),
      },

      schedule: {
        hero: { ...hero, headline: "Schedule" },
        note: "View our current class schedule below.",
        ...(scheduleIframes !== undefined && { iframes: scheduleIframes }),
      },

      blog: {
        heroHeadline: "Latest from the blog",
        posts: [
          {
            slug: "placeholder-post",
            title: "Placeholder post",
            publishedAt: "2024-01-01",
            excerpt: "This is a placeholder blog post for the eval build.",
            body: "## Placeholder\n\nContent goes here.",
          },
        ],
      },

      legal: [
        {
          slug: "privacy-policy",
          title: "Privacy policy",
          blocks: [legalBlock],
        },
        {
          slug: "terms-of-use",
          title: "Terms of use",
          blocks: [legalBlock],
        },
      ],
    },
  };

  return fixture;
}
