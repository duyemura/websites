import type { GymSiteContent } from "@milo/shared-types";
import type { SynthesizeArtifact } from "../../types/pipeline-artifacts";

/**
 * Builds a minimal GymSiteContent fixture from synthesized template metadata.
 * Used exclusively for component-eval builds — fills all required slots with
 * placeholder text so the Astro template renders without errors.
 */
export function buildFixture(synthesize: SynthesizeArtifact): GymSiteContent {
  const gymName = "Placeholder Gym";
  const city = "Springfield";
  const stateAbbr = "CA";

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
        featuredPrograms: ["group-fitness", "personal-training"],
        features: [feature(1), feature(2), feature(3), feature(4)],
        communityHeadline: "A community that keeps you going",
        communityProps: [valueProp(1), valueProp(2), valueProp(3)],
        trustHeadline: "Join hundreds of members",
        howItWorksHeadline: "How it works",
        howItWorks: [step(1), step(2), step(3)],
        testimonials: [testimonial],
        faq: [faqItem(1), faqItem(2)],
      },

      programs: [
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
          testimonials: [testimonial],
          faq: [faqItem(1), faqItem(2)],
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
          testimonials: [testimonial],
          faq: [faqItem(1), faqItem(2)],
        },
      ],

      about: {
        hero: { ...hero, headline: "About us" },
        gymStory: "We started this gym because we believe everyone deserves great coaching.",
        team: [
          {
            name: "Coach Alex",
            title: "Head coach",
            photoUrl: "__NO_IMAGE__",
            bio: "10 years of coaching experience.",
          },
        ],
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
        faq: [faqItem(1), faqItem(2)],
      },

      schedule: {
        hero: { ...hero, headline: "Schedule" },
        note: "View our current class schedule below.",
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
