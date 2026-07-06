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
}

export interface BusinessInfo {
  name: string;
  tagline: string;              // one-sentence entity description (feeds LocalBusiness.description + llms.txt)
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
}

export interface HomeContent {
  hero: HeroContent;
  valueProps: ValueProp[];
  programsHeadline: string;
  featuredPrograms: string[];        // program slugs
  features: Feature[];               // FeatureGrid items
  communityHeadline: string;         // "A community that will keep you going"
  communityProps: ValueProp[];
  trustHeadline: string;
  howItWorks: Step[];
  howItWorksHeadline: string;
  testimonials: Testimonial[];
  faq: FAQItem[];
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
  richContent?: RichContentSection[];
}

export interface AboutContent {
  hero: HeroContent;
  gymStory: string;                  // markdown allowed
  team: TeamMember[];
  richContent?: RichContentSection[];
}

export interface PricingContent {
  hero: HeroContent;
  grid?: PricingGridContent;
  form?: { headline: string; intro: string };
}
export interface PricingGridContent { headline?: string; subheading?: string; plans: PricingPlan[] }
export interface PricingPlan {
  name: string; price: string; period?: string; description?: string;
  features: string[]; cta: { label: string; url: string };
  highlighted?: boolean; badge?: string;
}

export interface ContactContent { hero: HeroContent; intro?: string }

export interface ScheduleContent {
  hero: HeroContent;
  widgetEmbedHtml?: string;          // PushPress booking widget embed
  note?: string;
}

export interface BlogContent { heroHeadline: string; posts: BlogPost[] }
export interface BlogPost {
  slug: string; title: string; publishedAt: string; excerpt: string;
  category?: string;                 // "Education" | "Newsletters" | "Recipes" | ...
  body: string;                      // markdown
  coverImageUrl?: string; author?: string; tags?: string[];
}

export interface LocalGuideContent {
  hero: HeroContent;
  sections: RichContentSection[];
}

export interface LegalPage { slug: string; title: string; blocks: ContentBlock[] }

// --- Shared ---
export interface HeroContent {
  headline: string; subheading?: string;
  ctaLabel?: string; ctaUrl?: string;
  backgroundImageUrl?: string;
}
export interface ValueProp { icon: string; headline: string; body: string }
export interface Feature { icon: string; label: string }
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

export interface RichContentSection { headline?: string; blocks: ContentBlock[] }
