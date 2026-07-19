// The contract between the content mapper (API side) and the template.
// gym.json must validate against GymSiteContent.

export interface GymSiteContent {
  meta: SiteMeta;
  business: BusinessInfo;
  brand: BrandTokens;
  navigation: Navigation;
  pages: PageContent;
}

export interface SiteMeta {
  siteId: string;               // site uuid — used in form POST endpoint
  apiBaseUrl: string;           // e.g. https://api.example.com (no trailing slash)
  siteUrl: string;              // canonical origin e.g. https://ksathleticclub.com (no trailing slash)
  defaultTitle: string;
  defaultDescription: string;
  preview?: boolean;            // true → robots noindex + Disallow
  googleSiteVerification?: string;
  bingVerification?: string;
  googleTagManagerId?: string;  // preferred
  googleAnalyticsId?: string;   // fallback if no GTM
  facebookPixelId?: string;     // fallback if no GTM
  tiktokPixelId?: string;       // fallback if no GTM
  /** Which renderer template to use. Defaults to "baseline". */
  templateTheme?: "baseline" | "impact" | "beanburito";
}

export interface BusinessInfo {
  name: string;
  tagline: string;              // one-sentence entity description (feeds LocalBusiness.description + llms.txt)
  /** User-facing category phrase, e.g. "CrossFit gym" or "yoga studio". */
  category?: string;
  address: { street: string; city: string; state: string; zip: string };
  phone: string;
  email?: string;
  hours: { days: string[]; opens: string; closes: string }[]; // 24h "05:00"
  coordinates?: { lat: number; lng: number };
  primaryCta: { label: string; url: string };   // "Free Discovery Call"
  trialCta?: { label: string; url: string };    // "Try 28 Days for $28"
  geo: { city: string; state: string; stateAbbr: string };
  serviceArea?: string[];
  aggregateRating?: { ratingValue: string; reviewCount: number; bestRating?: string };
  social?: {
    facebook?: string; instagram?: string; twitter?: string;
    tiktok?: string; youtube?: string;
  };
  mapEmbedUrl?: string;         // Google Maps embed iframe src
}

export const NO_IMAGE = "__NO_IMAGE__";

export interface BrandTokens {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  headingFont: string;          // Google Fonts family name
  bodyFont: string;
  logoUrl: string | typeof NO_IMAGE;
  logoAlt: string;
}

export interface Navigation {
  announcement?: { text: string; url?: string };
  header: NavItem[];
  footer: FooterGroup[];
  membersApp?: { ios?: string; android?: string };
}
export interface NavItem { label: string; href: string; children?: NavItem[] }
export interface FooterGroup { label: string; links: { label: string; href: string }[] }

export interface PageContent {
  home: HomeContent;
  programs: ProgramContent[];
  about: AboutContent;
  pricing: PricingContent;
  contact: ContactContent;
  schedule: ScheduleContent;
  blog: BlogContent;
  localGuide?: LocalGuideContent;
  legal: LegalPage[];
  /**
   * Drop-in / landing page — high-conversion, single-goal.
   * Supports all three closure patterns; use whichever the gym's booking
   * infrastructure supports. The ClosureBlock component renders the best
   * available option and hides itself when none are configured.
   */
  dropIn?: DropInContent;
}

/**
 * Three closure patterns for conversion landing pages, in priority order:
 *  1. iframe  — booking widget embedded directly (no page exit, highest conversion)
 *  2. external — link out to booking system (Mindbody, PushPress Pay, Shopify, etc.)
 *  3. internal — link to /contact or /pricing (lightest ask, fallback)
 */
export interface LandingPageClosure {
  /** Embedded booking widget, calendar, payment form, or sales page */
  iframe?: IframeEmbed;
  /** Link out to an external booking or purchase page */
  externalUrl?: string;
  externalLabel?: string;
  /** Internal CTA (falls back to business.primaryCta when omitted) */
  internalUrl?: string;
  internalLabel?: string;
}

export interface DropInContent {
  hero: HeroContent;
  /** What the visitor gets and what it costs — no ambiguity */
  offer?: {
    headline: string;           // "Drop In Anytime — $30/class"
    description?: string;
    priceDisplay?: string;      // "$30" or "Free first class"
    includes?: string[];        // ["Full class access", "Coach-led session", "No commitment"]
  };
  /** 3-step "how it works" specific to the drop-in flow */
  steps?: Step[];
  testimonials?: Testimonial[];
  faq?: FAQItem[];
  closure: LandingPageClosure;
}

export interface IframeEmbed {
  src: string;                       // iframe src URL
  /** Template-defined variant that controls default styling (review, schedule, form, video, default). */
  variant?: string;
  title?: string;                    // accessible title / optional section heading
  width?: string;                    // CSS width override
  height?: string;                   // CSS height override (e.g. "500px", "60vh")
  sandbox?: string;                  // explicit sandbox policy
  style?: string;                    // inline style overrides
  allow?: string;                    // iframe allow attribute
  referrerpolicy?: string;           // iframe referrer policy, e.g. "no-referrer", "origin"
  loading?: "eager" | "lazy";        // iframe loading strategy
}

export interface HomeContent {
  hero: HeroContent;
  valueProps: ValueProp[];
  programsHeadline: string;
  programsSubheadline?: string;      // supporting line under programs headline
  featuredPrograms: string[];        // program slugs
  features: Feature[];               // FeatureGrid items
  communityHeadline: string;         // "A community that will keep you going"
  communityProps: ValueProp[];
  trustHeadline: string;
  howItWorks: Step[];
  howItWorksHeadline: string;
  testimonials: Testimonial[];
  faq: FAQItem[];
  iframes?: IframeEmbed[];            // third-party iframe widgets captured from source or added by admin
  ctaSubtext?: string;               // supporting copy under bottom CTA headline
  ctaHeadline?: string;              // distinct bottom CTA headline (falls back to trustHeadline)
  richContent?: RichContentSection[];
}

export interface ProgramContent {
  slug: string;
  name: string;
  shortDescription: string;
  coverImageUrl: string;
  geoHeadline?: string;              // default: `${name} in ${geo.city}, ${geo.stateAbbr}`
  hero: HeroContent;
  whatIsIt: { headline: string; body: string };
  whatMakesUsDifferent: string[];
  whatToExpect: { headline: string; steps: string[] };
  whoIsItFor: string[];
  gettingStarted: Step[];
  testimonials: Testimonial[];
  faq: FAQItem[];
  iframes?: IframeEmbed[];            // program-page third-party iframe widgets
  richContent?: RichContentSection[];
}

export interface CtaBandContent {
  headline?: string;
  subtext?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Optional artwork behind the CTA band. Set to `null` to remove it; omit to use the template default. */
  artwork?: CtaArtwork | null;
}

export interface CtaArtwork {
  kind: "svg" | "image";
  /** Raw SVG markup for `svg`, or an image URL for `image`. */
  value: string;
  /** CSS background-position equivalent, e.g. "97% 60%". */
  position?: string;
  /** CSS background-size equivalent, e.g. "auto 169%". */
  size?: string;
  /** Opacity from 0 to 1. */
  opacity?: number;
}

export interface AboutContent {
  hero: HeroContent;
  gymStory: string;                  // markdown allowed
  team: TeamMember[];
  /** Community/story section content used by the about-page archetype. */
  communityHeadline?: string;
  communityProps?: ValueProp[];
  /** Long-form HTML body for the about-page community section. */
  communityBody?: string;
  /** Generic founder/background story band for the about-page archetype. */
  story?: StoryBandContent;
  /** Distinct bottom CTA headline on the about page. */
  ctaHeadline?: string;
  /** Structured CTA band configuration. Takes precedence over ctaHeadline when provided. */
  ctaBand?: CtaBandContent;
  /** About-page testimonials (fall back to home.testimonials in the renderer). */
  testimonials?: Testimonial[];
  faq?: FAQItem[];
  iframes?: IframeEmbed[];
  richContent?: RichContentSection[];
}

export interface StoryBandContent {
  headline?: string;
  subheadline?: string;
  imageUrl?: string;
  imageAlt?: string;
  blocks?: RichContentBlock[];
}

export interface PricingContent {
  hero: HeroContent;
  grid?: PricingGridContent;
  form?: { headline: string; intro: string };
  faq?: FAQItem[];
  iframes?: IframeEmbed[];
}
export interface PricingGridContent { headline?: string; subheading?: string; plans: PricingPlan[] }
export interface PricingPlan {
  name: string; price: string; period?: string; description?: string;
  features: string[]; cta: { label: string; url: string };
  highlighted?: boolean; badge?: string;
}

export interface ContactContent {
  hero: HeroContent;
  intro?: string;
  faq?: FAQItem[];
  iframes?: IframeEmbed[];
}


export interface ScheduleContent {
  hero: HeroContent;
  note?: string;
  faq?: FAQItem[];
  iframes?: IframeEmbed[];            // booking/schedule widgets rendered as generic iframe embeds
}

export interface BlogContent {
  heroHeadline: string;
  posts: BlogPost[];
  faq?: FAQItem[];
  /** Optional dark hero for templates that render the blog index as a full page. */
  hero?: HeroContent;
  /** Optional bottom-of-page CTA headline for templates with a ctaBand. */
  ctaHeadline?: string;
}
export interface BlogPost {
  slug: string; title: string; publishedAt: string; excerpt: string;
  category?: string;                 // "Education" | "Newsletters" | "Recipes" | ...
  body: string;                      // markdown
  coverImageUrl?: string; author?: string; tags?: string[];
}

export interface LocalGuideContent {
  hero: HeroContent;
  sections: RichContentSection[];
  richContent?: RichContentSection[];
  faq?: FAQItem[];
}

export interface LegalPage { slug: string; title: string; blocks: ContentBlock[] }

// --- Shared ---
export interface HeroContent {
  headline: string; subheading?: string;
  /** Optional longer body copy under the headline. */
  intro?: string;
  ctaLabel?: string; ctaUrl?: string;
  backgroundImageUrl?: string;
  /** When false, render the hero headline as an h2 because the page provides its own h1 (e.g. geo H1 on program pages). */
  renderAsH1?: boolean;
}
export interface ValueProp { icon: string; headline: string; body: string }
export interface Feature {
  icon: string;
  label: string;
  /** URL for an optional background image rendered behind the amenity card. */
  imageUrl?: string;
  /** Renderer-only layout hints from the section contract. */
  position?: { col?: number; row?: number };
  background?: "accent" | "dark" | "transparent" | "image";
}
export interface Step { number: number; headline: string; body: string }
export interface Testimonial { quote: string; name: string; photoUrl?: string; program?: string }
export interface FAQItem { question: string; answer: string }
export interface TeamMember { name: string; title: string; photoUrl: string; bio?: string }

export type ContentBlock =
  | { type: "text"; html: string }
  | { type: "image"; url: string; alt: string; caption?: string; width?: number; height?: number }
  | { type: "video"; url: string; poster?: string }
  | { type: "columns"; columns: ContentBlock[][] }
  | { type: "callout"; text: string; style: "info" | "warning" | "tip" }
  | { type: "embed"; html: string };

export type RichContentBlock = ContentBlock;

export interface RichContentSection { headline?: string; blocks: ContentBlock[] }
