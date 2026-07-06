# Gym Astro Template (Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One best-in-class Astro marketing/local-SEO template for gyms, rendered from a `gym.json` content file, plus the API-side lead capture endpoint, site versioning (publish/rollback with the mirror as v1), redirect-map-aware template deploy runner, and an eval script.

**Architecture:** Static Astro site in `apps/renderer` reads `src/content/gym.json` at build time (fixture-driven in dev/test). Brand tokens become CSS custom properties; Tailwind maps to them. SEO (5 JSON-LD schemas, geo titles, OG, llms.txt, sitemap) and tracking (GTM/GA/Pixel + UTM capture) are baked into the layout. API side (apps/api): public lead capture route, `site_versions` table + publish/rollback service, and a template deploy service that builds the renderer, uploads dist to an immutable S3 prefix, emits redirect pages for orphaned mirror URLs, and records a version.

**Tech Stack:** Astro 5 + Tailwind (renderer), vitest + cheerio (renderer dist tests), marked (blog markdown), Fastify 5 + Kysely + Zod (API), Playwright (eval).

**Spec:** `docs/superpowers/specs/2026-07-05-gym-template-system-design.md` — **Revision 2 section wins** over earlier sections where they conflict.

**Conventions for the executor (read first):**
1. Renderer commands run from `apps/renderer/`; API commands run from `apps/api/`. Never run `pnpm test` from the repo root (turbo intercepts it).
2. Renderer tests assert on **built dist HTML** (one `astro build` in vitest globalSetup, cheerio assertions). This is deliberate — unit-testing `.astro` files is awkward; dist assertions test what ships.
3. API glue conventions (route autoload, `db` import in tests, `jsonb()`, migration numbering) follow the existing codebase — if this plan disagrees with `src/types/db.ts` or `test/setup.ts`, the codebase wins for glue, the plan wins for behavior and assertions.
4. `src/content/gym.json` is **gitignored**. Dev/tests copy the fixture into place via `pnpm use:fixture`.
5. Commit after every task with the message given.

---

## Task 1: Content schema types

**Files:**
- Create: `apps/renderer/src/types/gym-content.ts`

- [ ] **Step 1: Write the types file**

```typescript
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

export interface BrandTokens {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  headingFont: string;          // Google Fonts family name
  bodyFont: string;
  logoUrl: string;
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
```

- [ ] **Step 2: Verify typecheck**

Run from `apps/renderer/`: `pnpm typecheck` (runs `astro check`).
Expected: 0 errors (an empty-src warning is fine).

- [ ] **Step 3: Commit**

```bash
git add apps/renderer/src/types/gym-content.ts
git commit -m "feat(template): gym content schema — the mapper/template contract"
```

---

## Task 2: Fixture content + loader + use:fixture script

**Files:**
- Create: `apps/renderer/src/content/gym.fixture.json`
- Create: `apps/renderer/src/lib/content.ts`
- Modify: `apps/renderer/package.json` (scripts)
- Modify: `apps/renderer/.gitignore` (ignore `src/content/gym.json`)

- [ ] **Step 1: Write the fixture** — a complete KSA-shaped site. Trimmed copy, full structure.

```json
{
  "meta": {
    "siteId": "00000000-0000-0000-0000-00000000f1x1",
    "apiBaseUrl": "https://api.example.com",
    "siteUrl": "https://fixture-gym.example.com",
    "defaultTitle": "KS Athletic Club",
    "defaultDescription": "CrossFit, bootcamp, and personal training in Overland Park, KS.",
    "preview": false,
    "googleSiteVerification": "fixture-gsc-token",
    "googleTagManagerId": "GTM-FIXTURE1"
  },
  "business": {
    "name": "KS Athletic Club",
    "tagline": "KS Athletic Club is a CrossFit, bootcamp, and personal training gym in Overland Park, KS serving adults of all fitness levels.",
    "address": { "street": "14875 Metcalf Ave", "city": "Overland Park", "state": "Kansas", "zip": "66223" },
    "phone": "(913) 320-0043",
    "email": "hello@fixture-gym.example.com",
    "hours": [
      { "days": ["Monday","Tuesday","Wednesday","Thursday","Friday"], "opens": "05:00", "closes": "21:00" },
      { "days": ["Saturday","Sunday"], "opens": "07:00", "closes": "12:00" }
    ],
    "coordinates": { "lat": 38.8672, "lng": -94.6676 },
    "primaryCta": { "label": "Free Discovery Call", "url": "/contact" },
    "trialCta": { "label": "Try 28 Days for $28", "url": "/pricing" },
    "geo": { "city": "Overland Park", "state": "Kansas", "stateAbbr": "KS" },
    "serviceArea": ["Leawood", "Olathe", "Lenexa", "Prairie Village"],
    "aggregateRating": { "ratingValue": "4.9", "reviewCount": 127 },
    "social": {
      "facebook": "https://facebook.com/fixturegym",
      "instagram": "https://instagram.com/fixturegym",
      "youtube": "https://youtube.com/@fixturegym"
    },
    "mapEmbedUrl": "https://www.google.com/maps/embed?pb=fixture"
  },
  "brand": {
    "primaryColor": "#0f172a",
    "secondaryColor": "#334155",
    "accentColor": "#f59e0b",
    "headingFont": "Oswald",
    "bodyFont": "Inter",
    "logoUrl": "https://placehold.co/200x60?text=KSAC",
    "logoAlt": "KS Athletic Club"
  },
  "navigation": {
    "announcement": { "text": "Try 28 Days for $28", "url": "/pricing" },
    "header": [
      { "label": "Programs", "href": "/programs/crossfit-classes", "children": [
        { "label": "CrossFit", "href": "/programs/crossfit-classes" },
        { "label": "Sweat Bootcamp", "href": "/programs/sweat-bootcamp" },
        { "label": "Personal Training", "href": "/programs/personal-training" }
      ]},
      { "label": "Schedule", "href": "/schedule" },
      { "label": "Pricing", "href": "/pricing" },
      { "label": "About", "href": "/about" },
      { "label": "Blog", "href": "/blog" },
      { "label": "Contact", "href": "/contact" }
    ],
    "footer": [
      { "label": "Programs", "links": [
        { "label": "CrossFit", "href": "/programs/crossfit-classes" },
        { "label": "Sweat Bootcamp", "href": "/programs/sweat-bootcamp" },
        { "label": "Personal Training", "href": "/programs/personal-training" }
      ]},
      { "label": "About", "links": [
        { "label": "About Us", "href": "/about" },
        { "label": "Local Guide", "href": "/local-guide" },
        { "label": "Contact Us", "href": "/contact" }
      ]},
      { "label": "Legal", "links": [
        { "label": "Privacy Policy", "href": "/legal/privacy-policy" },
        { "label": "Terms of Use", "href": "/legal/terms-of-use" }
      ]}
    ],
    "membersApp": { "ios": "https://apps.apple.com/fixture", "android": "https://play.google.com/fixture" }
  },
  "pages": {
    "home": {
      "hero": {
        "headline": "Get in the best shape of your life",
        "subheading": "Our gym is dedicated to making you stronger, leaner, and healthier so you can live a life without limitations.",
        "ctaLabel": "Get Started!",
        "ctaUrl": "/contact",
        "backgroundImageUrl": "https://placehold.co/1600x900?text=Hero"
      },
      "valueProps": [
        { "icon": "🏠", "headline": "A Welcoming Gym Near You", "body": "A friendly club environment for people at all fitness levels." },
        { "icon": "🌱", "headline": "Beginner Friendly", "body": "Every workout scales to where you are today." },
        { "icon": "🤝", "headline": "Accountability", "body": "Coaches and community that keep you showing up." }
      ],
      "programsHeadline": "Every body is unique. Find a fitness routine that works for you.",
      "featuredPrograms": ["crossfit-classes", "sweat-bootcamp", "personal-training"],
      "features": [
        { "icon": "🥗", "label": "Nutrition Programming" },
        { "icon": "📱", "label": "Members Only App" },
        { "icon": "📅", "label": "Weekend Classes" },
        { "icon": "⚡", "label": "Easy Scheduling" },
        { "icon": "🎟️", "label": "Class Reservations" },
        { "icon": "🎯", "label": "Individualized Programming" }
      ],
      "communityHeadline": "A community that will keep you going",
      "communityProps": [
        { "icon": "🏅", "headline": "Expert Coaching", "body": "Certified coaches in every class." },
        { "icon": "🌱", "headline": "Beginner Friendly", "body": "Start where you are." },
        { "icon": "🧭", "headline": "Structured Programs", "body": "A plan, not a guess." },
        { "icon": "❤️", "headline": "Supportive Community", "body": "Train with people who cheer for you." }
      ],
      "trustHeadline": "Trusted and Loved By Hundreds of Overland Park Residents",
      "howItWorksHeadline": "Getting Started Is Easy",
      "howItWorks": [
        { "number": 1, "headline": "Schedule a 15-Minute Call", "body": "Tell us your goals." },
        { "number": 2, "headline": "Start the Right Way", "body": "Movement screening with a coach." },
        { "number": 3, "headline": "Choose Your Membership", "body": "Pick the plan that fits." }
      ],
      "testimonials": [
        { "quote": "I got stronger in 3 months here than 3 years alone.", "name": "Jamie R.", "program": "CrossFit" },
        { "quote": "The coaches actually know my name and my goals.", "name": "Priya S.", "program": "Sweat Bootcamp" }
      ],
      "faq": [
        { "question": "Is CrossFit good for beginners?", "answer": "Yes. All workouts are coach-led and scalable to any fitness level." },
        { "question": "Do I need to be in shape before starting?", "answer": "No. We meet you where you are and scale everything." },
        { "question": "Do I have to sign a long-term contract?", "answer": "No. We offer flexible month-to-month memberships." },
        { "question": "How long are classes?", "answer": "Classes are 60 minutes: warm-up, strength or skill work, workout, and cool down." },
        { "question": "What should I bring to my first workout?", "answer": "Water, comfortable training shoes, and clothes you can move in." },
        { "question": "Do you help with nutrition?", "answer": "Yes. Nutrition coaching is available with every membership." }
      ]
    },
    "programs": [
      {
        "slug": "crossfit-classes",
        "name": "CrossFit Classes",
        "shortDescription": "Coach-led strength and conditioning for every level.",
        "coverImageUrl": "https://placehold.co/800x600?text=CrossFit",
        "hero": { "headline": "Try our CrossFit Classes", "subheading": "Get stronger with a plan.", "ctaLabel": "Free Discovery Call", "ctaUrl": "/contact", "backgroundImageUrl": "https://placehold.co/1600x900?text=CrossFit" },
        "whatIsIt": { "headline": "What is CrossFit?", "body": "Constantly varied functional movements at an intensity that is right for you, with professional coaching, structured programming, and a supportive community." },
        "whatMakesUsDifferent": [
          "Coach-led every class — guidance from start to finish",
          "Scalable for all fitness levels — beginners welcome",
          "Strength + conditioning programmed weekly",
          "Supportive, welcoming community",
          "Progress tracking so you know you're improving"
        ],
        "whatToExpect": { "headline": "What to expect in a class", "steps": ["Warm-Up & Mobility", "Strength or Skill Work", "Workout of the Day", "Cool Down & Recovery"] },
        "whoIsItFor": ["Busy adults who want a plan", "Former athletes getting back into it", "Complete beginners", "Anyone bored of the globo gym"],
        "gettingStarted": [
          { "number": 1, "headline": "Book a discovery call", "body": "15 minutes, no pressure." },
          { "number": 2, "headline": "Movement screening", "body": "A coach learns how you move." },
          { "number": 3, "headline": "Join your first class", "body": "We'll be expecting you." }
        ],
        "testimonials": [ { "quote": "Best coaching in Overland Park, period.", "name": "Mark T.", "program": "CrossFit" } ],
        "faq": [
          { "question": "Do I need CrossFit experience?", "answer": "No. All workouts are coach-led and scalable for beginners." },
          { "question": "How often should I train?", "answer": "Most members attend 3–5 classes per week depending on their goals." }
        ]
      },
      {
        "slug": "sweat-bootcamp",
        "name": "Sweat Bootcamp",
        "shortDescription": "High-energy circuit training. Zero barbells, all results.",
        "coverImageUrl": "https://placehold.co/800x600?text=Sweat",
        "hero": { "headline": "Sweat Bootcamp", "subheading": "Beginner-friendly workouts adjusted to any fitness level.", "ctaLabel": "Free Discovery Call", "ctaUrl": "/contact", "backgroundImageUrl": "https://placehold.co/1600x900?text=Sweat" },
        "whatIsIt": { "headline": "Why it works", "body": "Structured circuit training that blends strength and cardio for conditioning and weight loss." },
        "whatMakesUsDifferent": ["Beginner-friendly by design", "No barbell complexity", "Coached, not just supervised", "Fun, loud, motivating"],
        "whatToExpect": { "headline": "What you'll do in class", "steps": ["Warm-Up", "Circuit Training", "Cool Down & Stretch"] },
        "whoIsItFor": ["Fitness newcomers", "People who want to lose weight", "Anyone who hates boring cardio"],
        "gettingStarted": [
          { "number": 1, "headline": "Book a discovery call", "body": "Tell us your goals." },
          { "number": 2, "headline": "Try a class", "body": "Feel the energy." },
          { "number": 3, "headline": "Pick your plan", "body": "Month to month." }
        ],
        "testimonials": [ { "quote": "I look forward to 6am now. Who am I?", "name": "Dana K.", "program": "Sweat Bootcamp" } ],
        "faq": [ { "question": "Is SWEAT the same as CrossFit?", "answer": "No. SWEAT is circuit-based with no barbell work — it's our most beginner-friendly program." } ]
      },
      {
        "slug": "personal-training",
        "name": "Personal Training",
        "shortDescription": "A 360-degree approach: training, lifestyle, and nutrition.",
        "coverImageUrl": "https://placehold.co/800x600?text=PT",
        "hero": { "headline": "Try our Personal Training", "subheading": "A 360-degree approach to health and fitness.", "ctaLabel": "Free Consultation", "ctaUrl": "/contact", "backgroundImageUrl": "https://placehold.co/1600x900?text=PT" },
        "whatIsIt": { "headline": "Life without limitations", "body": "One-on-one coaching covering training, lifestyle, nutrition, sleep, stress, and recovery — with a baseline assessment and personalized tracking." },
        "whatMakesUsDifferent": ["Baseline health assessment", "Lifestyle and nutrition coaching included", "Personalized tracking", "VIP experience"],
        "whatToExpect": { "headline": "How it works", "steps": ["Assessment", "Personal plan", "Weekly sessions", "Ongoing adjustments"] },
        "whoIsItFor": ["People with specific goals", "Post-rehab athletes", "Anyone who wants full attention"],
        "gettingStarted": [
          { "number": 1, "headline": "Free consultation", "body": "Meet your coach." },
          { "number": 2, "headline": "Baseline assessment", "body": "Know your starting point." },
          { "number": 3, "headline": "Start training", "body": "Your plan, your pace." }
        ],
        "testimonials": [ { "quote": "My trainer rebuilt my squat after knee surgery.", "name": "Chris B.", "program": "Personal Training" } ],
        "faq": [ { "question": "How much does personal training cost?", "answer": "Pricing depends on session frequency — book a free consultation for exact rates." } ]
      }
    ],
    "about": {
      "hero": { "headline": "Meet Our Team", "subheading": "Our mission is to help you succeed.", "backgroundImageUrl": "https://placehold.co/1600x900?text=Team" },
      "gymStory": "KS Athletic Club is a gym in Overland Park, Kansas helping busy adults build strength, improve conditioning, and stay consistent with their health. Members travel from Overland Park, Leawood, Olathe, and Lenexa.",
      "team": [
        { "name": "Patrick Chandler", "title": "Owner", "photoUrl": "https://placehold.co/400x400?text=PC" },
        { "name": "TJ Kiblen", "title": "Owner & Founder", "photoUrl": "https://placehold.co/400x400?text=TJ" },
        { "name": "Christine Tran", "title": "Fitness Instructor", "photoUrl": "https://placehold.co/400x400?text=CT" },
        { "name": "Francisco Toyo", "title": "Fitness Instructor", "photoUrl": "https://placehold.co/400x400?text=FT" }
      ]
    },
    "pricing": {
      "hero": { "headline": "Membership Pricing", "subheading": "There is a plan here for you." },
      "grid": {
        "headline": "Simple plans, no surprises",
        "plans": [
          { "name": "Drop-in", "price": "$25", "period": "/class", "features": ["Any class", "No commitment"], "cta": { "label": "Book a class", "url": "/schedule" } },
          { "name": "Monthly Unlimited", "price": "$149", "period": "/month", "features": ["Unlimited classes", "All programs", "App access"], "cta": { "label": "Join Now", "url": "/contact" }, "highlighted": true, "badge": "Most Popular" },
          { "name": "Personal Training", "price": "Contact us", "features": ["1-on-1 coaching", "Nutrition included"], "cta": { "label": "Free Consultation", "url": "/contact" } }
        ]
      },
      "form": { "headline": "Get our full rate sheet", "intro": "Fill out the form below and we'll send complete membership rates and cost information." }
    },
    "contact": {
      "hero": { "headline": "Say hi to the team", "subheading": "We will get back to you as soon as we can." },
      "intro": "Prefer to talk? Call us or stop by for a tour."
    },
    "schedule": {
      "hero": { "headline": "Class Schedule", "subheading": "Reserve your spot — classes fill up." },
      "widgetEmbedHtml": "<div id=\"fixture-booking-widget\" data-widget=\"pushpress\">Booking widget placeholder</div>",
      "note": "First time? Book a Free Discovery Call and we'll walk you in."
    },
    "blog": {
      "heroHeadline": "Fitness Tips & News",
      "posts": [
        {
          "slug": "top-10-reasons-to-join-a-gym-in-overland-park",
          "title": "The Top 10 Reasons to Join a Gym in Overland Park",
          "publishedAt": "2026-05-01",
          "excerpt": "Thinking about joining a gym in Overland Park? Here are ten reasons to start now.",
          "category": "Education",
          "coverImageUrl": "https://placehold.co/1200x630?text=Blog1",
          "author": "TJ Kiblen",
          "body": "## Why now?\n\nJoining a gym is the highest-leverage health decision most adults make.\n\n1. **Coaching** beats guessing.\n2. **Community** beats willpower.\n\n![Members training](https://placehold.co/800x450?text=Training)\n\nCome see us in Overland Park."
        },
        {
          "slug": "5-healthy-restaurants-in-overland-park",
          "title": "5 Paleo & Keto Friendly Restaurants in Overland Park",
          "publishedAt": "2026-04-15",
          "excerpt": "Eat out without falling off your nutrition plan — our local picks.",
          "category": "Recipes",
          "body": "Eating well in Overland Park is easy if you know where to go.\n\n### Our picks\n\n- Spot one\n- Spot two\n- Spot three"
        },
        {
          "slug": "this-week-at-the-club",
          "title": "This Week at the Club",
          "publishedAt": "2026-06-20",
          "excerpt": "Events, celebrations, and what's coming up.",
          "category": "Newsletters",
          "body": "Saturday partner workout, new coach spotlight, and holiday hours."
        }
      ]
    },
    "localGuide": {
      "hero": { "headline": "The Overland Park Local Guide", "subheading": "Where to train, eat, and recover in Overland Park, KS." },
      "sections": [
        { "headline": "Best parks to work out", "blocks": [ { "type": "text", "html": "<p>Overland Park has outstanding outdoor training spots — here are our favorites.</p>" } ] },
        { "headline": "Coffee after class", "blocks": [ { "type": "text", "html": "<p>The post-workout coffee spots our members swear by.</p>" }, { "type": "callout", "text": "Members get 10% off at our partner cafe.", "style": "tip" } ] }
      ]
    },
    "legal": [
      { "slug": "privacy-policy", "title": "Privacy Policy", "blocks": [ { "type": "text", "html": "<p>Fixture privacy policy text.</p>" } ] },
      { "slug": "terms-of-use", "title": "Terms of Use", "blocks": [ { "type": "text", "html": "<p>Fixture terms of use text.</p>" } ] }
    ]
  }
}
```

- [ ] **Step 2: Content loader `src/lib/content.ts`**

```typescript
import type { GymSiteContent } from "../types/gym-content";
// gym.json is written by `pnpm use:fixture` (dev/test) or the deploy runner (production builds).
import raw from "../content/gym.json";

export const content = raw as unknown as GymSiteContent;

export const geoTitle = (page: string) =>
  `${page} in ${content.business.geo.city}, ${content.business.geo.stateAbbr} | ${content.business.name}`;

export function programBySlug(slug: string) {
  const p = content.pages.programs.find((p) => p.slug === slug);
  if (!p) throw new Error(`Unknown program slug: ${slug}`);
  return p;
}

export function programGeoHeadline(p: { name: string; geoHeadline?: string }) {
  return p.geoHeadline ?? `${p.name} in ${content.business.geo.city}, ${content.business.geo.stateAbbr}`;
}
```

- [ ] **Step 3: Scripts + gitignore**

In `apps/renderer/package.json` add to `"scripts"`:
```json
"use:fixture": "node -e \"require('fs').copyFileSync('src/content/gym.fixture.json','src/content/gym.json')\"",
"test": "pnpm use:fixture && vitest run"
```
Append to `apps/renderer/.gitignore`:
```
src/content/gym.json
```

- [ ] **Step 4: Verify**

Run from `apps/renderer/`: `pnpm use:fixture && pnpm typecheck`
Expected: gym.json created; 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer/src/content/gym.fixture.json apps/renderer/src/lib/content.ts apps/renderer/package.json apps/renderer/.gitignore
git commit -m "feat(template): KSA-shaped fixture content, loader, use:fixture script"
```

---

## Task 3: Test harness + GymLayout skeleton + brand tokens

**Files:**
- Modify: `apps/renderer/package.json` (devDeps)
- Create: `apps/renderer/vitest.config.ts`
- Create: `apps/renderer/test/global-setup.ts`
- Create: `apps/renderer/test/helpers.ts`
- Create: `apps/renderer/test/dist.spec.ts`
- Create: `apps/renderer/src/layouts/GymLayout.astro`
- Replace: `apps/renderer/tailwind.config.mjs`
- Create: `apps/renderer/src/pages/index.astro` (placeholder — completed in Task 7)

- [ ] **Step 1: Install dev deps**

Run from `apps/renderer/`: `pnpm add -D vitest cheerio`

- [ ] **Step 2: Harness**

`vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { globalSetup: "./test/global-setup.ts", testTimeout: 30_000 },
});
```

`test/global-setup.ts` — builds the fixture site ONCE for all dist tests:
```typescript
import { execSync } from "node:child_process";
export default function setup() {
  execSync("node -e \"require('fs').copyFileSync('src/content/gym.fixture.json','src/content/gym.json')\"", { stdio: "inherit" });
  execSync("pnpm build", { stdio: "inherit" });
}
```

`test/helpers.ts`:
```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as cheerio from "cheerio";
import fixture from "../src/content/gym.fixture.json";

export const gym = fixture;
export const distPath = (p: string) => join(process.cwd(), "dist", p);
export const distExists = (p: string) => existsSync(distPath(p));
export const readDist = (p: string) => readFileSync(distPath(p), "utf8");
export const loadPage = (p: string) => cheerio.load(readDist(p));

/** All parsed JSON-LD objects on a page. */
export function jsonLd(page: ReturnType<typeof loadPage>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  page('script[type="application/ld+json"]').each((_, el) => {
    out.push(JSON.parse(page(el).text()));
  });
  return out;
}
```

- [ ] **Step 3: Write the failing test**

`test/dist.spec.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { loadPage, gym } from "./helpers";

describe("layout skeleton", () => {
  it("homepage renders with gym name in title and hero headline in body", () => {
    const $ = loadPage("index.html");
    expect($("title").text()).toContain(gym.business.name);
    expect($("h1").first().text()).toContain(gym.pages.home.hero.headline);
  });

  it("brand tokens are emitted as CSS custom properties", () => {
    const $ = loadPage("index.html");
    const css = $("style").text();
    expect(css).toContain(`--color-primary: ${gym.brand.primaryColor}`);
    expect(css).toContain(`--font-heading:`);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run from `apps/renderer/`: `pnpm test`
Expected: FAIL — build fails or dist/index.html missing (no pages yet).

- [ ] **Step 5: Implement layout + tokens + placeholder homepage**

`tailwind.config.mjs` (replace):
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--color-primary)",
        secondary: "var(--color-secondary)",
        accent: "var(--color-accent)",
      },
      fontFamily: {
        heading: "var(--font-heading)",
        body: "var(--font-body)",
      },
    },
  },
};
```

`src/layouts/GymLayout.astro`:
```astro
---
import { content } from "../lib/content";

interface Props {
  title?: string;
  description?: string;
  /** Path of this page, e.g. "/programs/crossfit-classes" — used for canonical. */
  path: string;
  /** OG image override (hero/cover). */
  image?: string;
}
const { title, description, path, image } = Astro.props;
const { meta, business, brand } = content;

const pageTitle = title ?? meta.defaultTitle;
const pageDescription = description ?? meta.defaultDescription;

const fontsHref =
  "https://fonts.googleapis.com/css2?family=" +
  encodeURIComponent(brand.headingFont) + ":wght@400;600;700" +
  "&family=" + encodeURIComponent(brand.bodyFont) + ":wght@400;500;700&display=swap";

const rootCss = `:root{--color-primary:${brand.primaryColor};--color-secondary:${brand.secondaryColor};--color-accent:${brand.accentColor};--font-heading:'${brand.headingFont}',sans-serif;--font-body:'${brand.bodyFont}',sans-serif;}`;
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{pageTitle}</title>
    <meta name="description" content={pageDescription} />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href={fontsHref} />
    <style is:inline set:html={rootCss}></style>
    <slot name="head" />
  </head>
  <body class="font-body text-secondary bg-white">
    <slot />
    <!-- Hidden entity anchor for AI crawlers (AEO). Off-screen, NOT display:none. -->
    <p class="sr-only">
      {business.name} is a gym located at {business.address.street} in {business.geo.city}, {business.geo.stateAbbr}. {business.tagline}
    </p>
  </body>
</html>
```

`src/pages/index.astro` (placeholder — full homepage in Task 7):
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import { content, geoTitle } from "../lib/content";
const home = content.pages.home;
---
<GymLayout title={geoTitle("CrossFit, Bootcamp & Personal Training")} description={home.hero.subheading} path="/" image={home.hero.backgroundImageUrl}>
  <h1 class="font-heading text-4xl">{home.hero.headline}</h1>
</GymLayout>
```

- [ ] **Step 6: Run to verify pass**

Run from `apps/renderer/`: `pnpm test`
Expected: 2 passing.

- [ ] **Step 7: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): dist-assertion test harness, GymLayout skeleton, brand token theming"
```

---

## Task 4: SEO components (canonical/robots/OG, LocalBusiness, Breadcrumb)

**Files:**
- Create: `apps/renderer/src/components/seo/CanonicalMeta.astro`
- Create: `apps/renderer/src/components/seo/OpenGraph.astro`
- Create: `apps/renderer/src/components/seo/LocalBusinessSchema.astro`
- Create: `apps/renderer/src/components/seo/BreadcrumbSchema.astro`
- Modify: `apps/renderer/src/layouts/GymLayout.astro`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Write failing tests** (append to `test/dist.spec.ts`)

```typescript
import { jsonLd } from "./helpers";

describe("SEO layer", () => {
  it("homepage has canonical URL, robots index, and verification tag", () => {
    const $ = loadPage("index.html");
    expect($('link[rel="canonical"]').attr("href")).toBe(`${gym.meta.siteUrl}/`);
    expect($('meta[name="robots"]').attr("content")).toBe("index,follow");
    expect($('meta[name="google-site-verification"]').attr("content")).toBe(gym.meta.googleSiteVerification);
  });

  it("homepage has Open Graph + Twitter card tags", () => {
    const $ = loadPage("index.html");
    expect($('meta[property="og:title"]').attr("content")).toBeTruthy();
    expect($('meta[property="og:url"]').attr("content")).toBe(`${gym.meta.siteUrl}/`);
    expect($('meta[name="twitter:card"]').attr("content")).toBe("summary_large_image");
  });

  it("every page carries LocalBusiness+SportsActivityLocation with NAP, geo, hours, rating, sameAs", () => {
    const $ = loadPage("index.html");
    const lb = jsonLd($).find((s) => Array.isArray(s["@type"]) && (s["@type"] as string[]).includes("LocalBusiness"));
    expect(lb).toBeTruthy();
    expect(lb!["name"]).toBe(gym.business.name);
    expect(lb!["telephone"]).toBe(gym.business.phone);
    expect((lb!["geo"] as any).latitude).toBe(gym.business.coordinates.lat);
    expect((lb!["aggregateRating"] as any).reviewCount).toBe(String(gym.business.aggregateRating.reviewCount));
    expect(lb!["sameAs"]).toContain(gym.business.social.facebook);
    expect((lb!["areaServed"] as string[])).toContain("Leawood");
    expect(lb!["description"]).toBe(gym.business.tagline);
  });
});
```

- [ ] **Step 2: Run** — Expected: new tests FAIL (no schema/meta yet).

- [ ] **Step 3: Implement**

`src/components/seo/CanonicalMeta.astro`:
```astro
---
import { content } from "../../lib/content";
const { path } = Astro.props as { path: string };
const { meta } = content;
const canonical = `${meta.siteUrl}${path}`;
---
<link rel="canonical" href={canonical} />
<meta name="robots" content={meta.preview ? "noindex,nofollow" : "index,follow"} />
{meta.googleSiteVerification && <meta name="google-site-verification" content={meta.googleSiteVerification} />}
{meta.bingVerification && <meta name="msvalidate.01" content={meta.bingVerification} />}
```

`src/components/seo/OpenGraph.astro`:
```astro
---
import { content } from "../../lib/content";
const { title, description, path, image } = Astro.props as { title: string; description: string; path: string; image?: string };
const url = `${content.meta.siteUrl}${path}`;
const img = image ?? content.brand.logoUrl;
---
<meta property="og:type" content="website" />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
<meta property="og:url" content={url} />
<meta property="og:image" content={img} />
<meta property="og:site_name" content={content.business.name} />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content={title} />
<meta name="twitter:description" content={description} />
<meta name="twitter:image" content={img} />
```

`src/components/seo/LocalBusinessSchema.astro`:
```astro
---
import { content } from "../../lib/content";
const { business, meta } = content;
const sameAs = Object.values(business.social ?? {}).filter(Boolean);
const schema = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "SportsActivityLocation"],
  name: business.name,
  description: business.tagline,
  url: meta.siteUrl,
  telephone: business.phone,
  address: {
    "@type": "PostalAddress",
    streetAddress: business.address.street,
    addressLocality: business.address.city,
    addressRegion: business.geo.stateAbbr,
    postalCode: business.address.zip,
    addressCountry: "US",
  },
  ...(business.coordinates && {
    geo: { "@type": "GeoCoordinates", latitude: business.coordinates.lat, longitude: business.coordinates.lng },
  }),
  openingHoursSpecification: business.hours.map((h) => ({
    "@type": "OpeningHoursSpecification", dayOfWeek: h.days, opens: h.opens, closes: h.closes,
  })),
  areaServed: [business.geo.city, ...(business.serviceArea ?? [])],
  ...(business.aggregateRating && {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: business.aggregateRating.ratingValue,
      reviewCount: String(business.aggregateRating.reviewCount),
      bestRating: business.aggregateRating.bestRating ?? "5",
    },
  }),
  ...(sameAs.length > 0 && { sameAs }),
};
---
<script type="application/ld+json" set:html={JSON.stringify(schema)} />
```

`src/components/seo/BreadcrumbSchema.astro`:
```astro
---
import { content } from "../../lib/content";
const { crumbs } = Astro.props as { crumbs: { name: string; path: string }[] };
const schema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [{ name: "Home", path: "/" }, ...crumbs].map((c, i) => ({
    "@type": "ListItem", position: i + 1, name: c.name, item: `${content.meta.siteUrl}${c.path}`,
  })),
};
---
<script type="application/ld+json" set:html={JSON.stringify(schema)} />
```

Wire into `GymLayout.astro` — replace the head's `<slot name="head" />` area:
```astro
---
// add to frontmatter imports:
import CanonicalMeta from "../components/seo/CanonicalMeta.astro";
import OpenGraph from "../components/seo/OpenGraph.astro";
import LocalBusinessSchema from "../components/seo/LocalBusinessSchema.astro";
---
    <!-- inside <head>, after the fonts link: -->
    <CanonicalMeta path={path} />
    <OpenGraph title={pageTitle} description={pageDescription} path={path} image={image} />
    <LocalBusinessSchema />
    <style is:inline set:html={rootCss}></style>
    <slot name="head" />
```

- [ ] **Step 4: Run** — Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): SEO layer — canonical/robots/verification, OG+Twitter, LocalBusiness+Breadcrumb JSON-LD"
```

---

## Task 5: Tracking — GTM/GA/Pixels + UTM capture + standard events

**Files:**
- Create: `apps/renderer/src/components/tracking/Tracking.astro`
- Create: `apps/renderer/public/scripts/utm-tracker.js`
- Create: `apps/renderer/public/scripts/tracking-events.js`
- Modify: `apps/renderer/src/layouts/GymLayout.astro`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Failing tests** (append)

```typescript
describe("tracking layer", () => {
  it("injects GTM when googleTagManagerId is set (fixture has one)", () => {
    const html = readDist("index.html");
    expect(html).toContain(`googletagmanager.com/gtm.js`);
    expect(html).toContain(gym.meta.googleTagManagerId);
  });

  it("loads UTM tracker and events scripts on every page", () => {
    const $ = loadPage("index.html");
    expect($('script[src="/scripts/utm-tracker.js"]').length).toBe(1);
    expect($('script[src="/scripts/tracking-events.js"]').length).toBe(1);
  });
});
```
Add `readDist` to the helpers import line in `dist.spec.ts`.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/components/tracking/Tracking.astro`:
```astro
---
import { content } from "../../lib/content";
const { meta } = content;
const gtm = meta.googleTagManagerId;
const gaSnippet = meta.googleAnalyticsId
  ? `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${meta.googleAnalyticsId}');`
  : "";
const fbSnippet = meta.facebookPixelId
  ? `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta.facebookPixelId}');fbq('track','PageView');`
  : "";
const gtmSnippet = gtm
  ? `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`
  : "";
---
{gtm ? (
  <script is:inline set:html={gtmSnippet} />
) : (
  <>
    {meta.googleAnalyticsId && (
      <>
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${meta.googleAnalyticsId}`}></script>
        <script is:inline set:html={gaSnippet} />
      </>
    )}
    {meta.facebookPixelId && <script is:inline set:html={fbSnippet} />}
  </>
)}
<script src="/scripts/utm-tracker.js" defer></script>
<script src="/scripts/tracking-events.js" defer></script>
```

`public/scripts/utm-tracker.js`:
```javascript
// Capture utm_* params on landing, persist for the session, inject into every form.
(function () {
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  try {
    var params = new URLSearchParams(location.search);
    KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) sessionStorage.setItem(k, v);
    });
  } catch (e) { /* sessionStorage unavailable — degrade silently */ }

  function inject() {
    document.querySelectorAll("form[data-lead-form]").forEach(function (form) {
      KEYS.forEach(function (k) {
        var v = sessionStorage.getItem(k);
        if (!v || form.querySelector('input[name="' + k + '"]')) return;
        var input = document.createElement("input");
        input.type = "hidden"; input.name = k; input.value = v;
        form.appendChild(input);
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inject);
  else inject();
})();
```

`public/scripts/tracking-events.js`:
```javascript
// Standard events: CTA clicks + lead form submits → GA4 (gtag/dataLayer) + Meta Pixel (fbq).
(function () {
  function fire(gaEvent, fbEvent) {
    try {
      if (window.gtag) window.gtag("event", gaEvent);
      else if (window.dataLayer) window.dataLayer.push({ event: gaEvent });
      if (window.fbq) window.fbq("track", fbEvent);
    } catch (e) { /* never break the page for tracking */ }
  }
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("[data-track]");
    if (!el) return;
    var kind = el.getAttribute("data-track");
    if (kind === "contact") fire("contact", "Contact");
    if (kind === "trial") fire("begin_checkout", "InitiateCheckout");
  });
  document.addEventListener("submit", function (e) {
    if (e.target && e.target.matches && e.target.matches("form[data-lead-form]")) {
      fire("generate_lead", "Lead");
    }
  });
})();
```

Wire `<Tracking />` into `GymLayout.astro` head (import + place after `<OpenGraph ... />`).

- [ ] **Step 4: Run** — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): native tracking — GTM/GA/Pixel injection, UTM session capture, standard events"
```

---

## Task 6: UI primitives + Header/Footer/Announcement/StickyCTA

**Files:**
- Create: `apps/renderer/src/components/ui/Container.astro`
- Create: `apps/renderer/src/components/ui/Button.astro`
- Create: `apps/renderer/src/components/ui/SectionHeading.astro`
- Create: `apps/renderer/src/components/chrome/Header.astro`
- Create: `apps/renderer/src/components/chrome/Footer.astro`
- Create: `apps/renderer/src/components/chrome/StickyCTA.astro`
- Modify: `apps/renderer/src/layouts/GymLayout.astro`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Failing tests** (append)

```typescript
describe("chrome", () => {
  it("header renders all top-level nav items and the announcement bar", () => {
    const $ = loadPage("index.html");
    const navText = $("header").text();
    for (const item of gym.navigation.header) expect(navText).toContain(item.label);
    expect($("header").text()).toContain(gym.navigation.announcement.text);
  });

  it("footer renders link groups, NAP, and social links", () => {
    const $ = loadPage("index.html");
    const footer = $("footer");
    for (const group of gym.navigation.footer) expect(footer.text()).toContain(group.label);
    expect(footer.text()).toContain(gym.business.address.street);
    expect(footer.text()).toContain(gym.business.phone);
    expect(footer.find(`a[href="${gym.business.social.instagram}"]`).length).toBe(1);
  });

  it("sticky CTA is present with the primary CTA label", () => {
    const $ = loadPage("index.html");
    expect($("#sticky-cta").text()).toContain(gym.business.primaryCta.label);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

`ui/Container.astro`:
```astro
<div class="mx-auto max-w-6xl px-4 sm:px-6"><slot /></div>
```

`ui/Button.astro`:
```astro
---
const { href, variant = "primary", track } = Astro.props as { href: string; variant?: "primary" | "outline"; track?: string };
const cls = variant === "primary"
  ? "inline-block rounded-lg bg-accent px-6 py-3 font-heading font-semibold text-white hover:opacity-90"
  : "inline-block rounded-lg border-2 border-primary px-6 py-3 font-heading font-semibold text-primary hover:bg-primary hover:text-white";
---
<a href={href} class={cls} data-track={track}><slot /></a>
```

`ui/SectionHeading.astro`:
```astro
---
const { title, subtitle } = Astro.props as { title: string; subtitle?: string };
---
<div class="mb-10 text-center">
  <h2 class="font-heading text-3xl font-bold text-primary sm:text-4xl">{title}</h2>
  {subtitle && <p class="mt-3 text-lg text-secondary">{subtitle}</p>}
</div>
```

`chrome/Header.astro`:
```astro
---
import { content } from "../../lib/content";
import Button from "../ui/Button.astro";
const { navigation, business, brand } = content;
---
<header class="border-b border-slate-100">
  {navigation.announcement && (
    <div class="bg-accent py-2 text-center text-sm font-semibold text-white">
      {navigation.announcement.url
        ? <a href={navigation.announcement.url}>{navigation.announcement.text}</a>
        : navigation.announcement.text}
    </div>
  )}
  <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
    <a href="/"><img src={brand.logoUrl} alt={brand.logoAlt} width="160" height="48" loading="eager" /></a>
    <nav aria-label="Main">
      <ul class="hidden items-center gap-6 lg:flex">
        {navigation.header.map((item) => (
          <li class="group relative">
            <a href={item.href} class="font-heading font-medium text-primary hover:text-accent">{item.label}</a>
            {item.children && (
              <ul class="invisible absolute left-0 top-full z-20 min-w-48 rounded-lg bg-white py-2 shadow-lg group-hover:visible">
                {item.children.map((c) => (
                  <li><a href={c.href} class="block px-4 py-2 text-sm text-secondary hover:bg-slate-50">{c.label}</a></li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
    <div class="flex items-center gap-3">
      {business.trialCta && <Button href={business.trialCta.url} variant="outline" track="trial">{business.trialCta.label}</Button>}
      <Button href={business.primaryCta.url} track="contact">{business.primaryCta.label}</Button>
    </div>
  </div>
  <!-- Mobile nav: simple details/summary, no JS -->
  <details class="border-t border-slate-100 lg:hidden">
    <summary class="cursor-pointer px-4 py-3 font-heading font-medium text-primary">Menu</summary>
    <ul class="space-y-1 px-4 pb-4">
      {navigation.header.map((item) => (
        <li>
          <a href={item.href} class="block py-1 text-primary">{item.label}</a>
          {item.children && item.children.map((c) => <a href={c.href} class="block py-1 pl-4 text-sm text-secondary">{c.label}</a>)}
        </li>
      ))}
    </ul>
  </details>
</header>
```

`chrome/Footer.astro`:
```astro
---
import { content } from "../../lib/content";
const { navigation, business, brand } = content;
const socials = Object.entries(business.social ?? {}).filter(([, url]) => Boolean(url)) as [string, string][];
---
<footer class="bg-primary py-12 text-white">
  <div class="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-2 lg:grid-cols-4">
    <div>
      <img src={brand.logoUrl} alt={brand.logoAlt} width="160" height="48" loading="lazy" />
      <!-- NAP — must match LocalBusiness schema exactly -->
      <address class="mt-4 not-italic text-sm text-slate-300">
        {business.name}<br />
        {business.address.street}<br />
        {business.address.city}, {business.geo.stateAbbr} {business.address.zip}<br />
        <a href={`tel:${business.phone.replace(/[^0-9+]/g, "")}`}>{business.phone}</a>
      </address>
    </div>
    {navigation.footer.map((group) => (
      <div>
        <h3 class="font-heading font-semibold uppercase tracking-wide">{group.label}</h3>
        <ul class="mt-3 space-y-2 text-sm text-slate-300">
          {group.links.map((l) => <li><a href={l.href} class="hover:text-white">{l.label}</a></li>)}
        </ul>
      </div>
    ))}
    <div>
      <h3 class="font-heading font-semibold uppercase tracking-wide">Follow us</h3>
      <ul class="mt-3 space-y-2 text-sm text-slate-300">
        {socials.map(([name, url]) => <li><a href={url} rel="noopener" class="capitalize hover:text-white">{name}</a></li>)}
      </ul>
      {navigation.membersApp && (
        <div class="mt-4 space-y-1 text-sm text-slate-300">
          {navigation.membersApp.ios && <a class="block hover:text-white" href={navigation.membersApp.ios}>Members App (iOS)</a>}
          {navigation.membersApp.android && <a class="block hover:text-white" href={navigation.membersApp.android}>Members App (Android)</a>}
        </div>
      )}
    </div>
  </div>
  <p class="mt-10 text-center text-xs text-slate-400">© {new Date().getFullYear()} {business.name}. All rights reserved.</p>
</footer>
```

`chrome/StickyCTA.astro`:
```astro
---
import { content } from "../../lib/content";
const { business } = content;
---
<div id="sticky-cta" class="fixed inset-x-0 bottom-0 z-30 hidden items-center justify-between gap-4 bg-primary px-4 py-3 text-white shadow-lg sm:justify-center lg:bottom-auto lg:top-0">
  <span class="hidden font-heading sm:inline">Ready to get started?</span>
  <a href={business.primaryCta.url} data-track="contact" class="rounded-lg bg-accent px-5 py-2 font-heading font-semibold text-white">{business.primaryCta.label} →</a>
</div>
<script is:inline>
  (function () {
    var bar = document.getElementById("sticky-cta");
    if (!bar) return;
    var shown = false;
    window.addEventListener("scroll", function () {
      var show = window.scrollY > window.innerHeight * 0.7;
      if (show !== shown) { shown = show; bar.classList.toggle("hidden", !show); bar.classList.toggle("flex", show); }
    }, { passive: true });
  })();
</script>
```

Wire into `GymLayout.astro` body:
```astro
---
// add imports:
import Header from "../components/chrome/Header.astro";
import Footer from "../components/chrome/Footer.astro";
import StickyCTA from "../components/chrome/StickyCTA.astro";
---
  <body class="font-body text-secondary bg-white">
    <Header />
    <main><slot /></main>
    <Footer />
    <StickyCTA />
    <!-- keep the sr-only entity anchor -->
```
(Add `sr-only` support: Tailwind provides it natively.)

- [ ] **Step 4: Run** — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): header with dropdown nav + announcement, NAP footer with socials, sticky CTA"
```

---

## Task 7: Homepage sections (Hero → FAQ) + FAQPage schema + full homepage

**Files:**
- Create: `apps/renderer/src/components/sections/Hero.astro`
- Create: `apps/renderer/src/components/sections/ValueProps.astro`
- Create: `apps/renderer/src/components/sections/FeatureGrid.astro`
- Create: `apps/renderer/src/components/sections/ProgramCards.astro`
- Create: `apps/renderer/src/components/sections/HowItWorks.astro`
- Create: `apps/renderer/src/components/sections/Testimonials.astro`
- Create: `apps/renderer/src/components/sections/FAQ.astro`
- Create: `apps/renderer/src/components/sections/CTABand.astro`
- Create: `apps/renderer/src/components/sections/Location.astro`
- Create: `apps/renderer/src/components/seo/FAQSchema.astro`
- Replace: `apps/renderer/src/pages/index.astro`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Failing tests** (append)

```typescript
describe("homepage", () => {
  it("renders all six FeatureGrid items and four community props", () => {
    const $ = loadPage("index.html");
    for (const f of gym.pages.home.features) expect($("body").text()).toContain(f.label);
    for (const p of gym.pages.home.communityProps) expect($("body").text()).toContain(p.headline);
  });

  it("renders program cards for each featured program with links", () => {
    const $ = loadPage("index.html");
    for (const slug of gym.pages.home.featuredPrograms) {
      expect($(`a[href="/programs/${slug}"]`).length).toBeGreaterThan(0);
    }
  });

  it("renders FAQ as accessible details/summary and emits FAQPage schema", () => {
    const $ = loadPage("index.html");
    expect($("details.faq-item").length).toBe(gym.pages.home.faq.length);
    const faq = jsonLd($).find((s) => s["@type"] === "FAQPage") as any;
    expect(faq).toBeTruthy();
    expect(faq.mainEntity.length).toBe(gym.pages.home.faq.length);
    expect(faq.mainEntity[0].name).toBe(gym.pages.home.faq[0].question);
  });

  it("renders the location section with address, directions link, and map embed", () => {
    const $ = loadPage("index.html");
    expect($("body").text()).toContain(gym.business.address.street);
    expect($('a[href^="https://www.google.com/maps"]').length).toBeGreaterThan(0);
    expect($(`iframe[src="${gym.business.mapEmbedUrl}"]`).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement the sections**

`sections/Hero.astro`:
```astro
---
import Button from "../ui/Button.astro";
import type { HeroContent } from "../../types/gym-content";
const { hero, h1 = true } = Astro.props as { hero: HeroContent; h1?: boolean };
const Tag = h1 ? "h1" : "h2";
const bg = hero.backgroundImageUrl ? `background-image:linear-gradient(rgba(15,23,42,.65),rgba(15,23,42,.65)),url('${hero.backgroundImageUrl}')` : "";
---
<section class="bg-primary bg-cover bg-center py-24 text-center text-white" style={bg}>
  <div class="mx-auto max-w-3xl px-4">
    <Tag class="font-heading text-4xl font-bold sm:text-5xl">{hero.headline}</Tag>
    {hero.subheading && <p class="mt-4 text-lg text-slate-200">{hero.subheading}</p>}
    {hero.ctaLabel && hero.ctaUrl && <div class="mt-8"><Button href={hero.ctaUrl} track="contact">{hero.ctaLabel}</Button></div>}
  </div>
</section>
```

`sections/ValueProps.astro`:
```astro
---
import Container from "../ui/Container.astro";
import SectionHeading from "../ui/SectionHeading.astro";
import type { ValueProp } from "../../types/gym-content";
const { items, headline } = Astro.props as { items: ValueProp[]; headline?: string };
const cols = items.length === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";
---
<section class="py-16">
  <Container>
    {headline && <SectionHeading title={headline} />}
    <div class={`grid gap-8 ${cols}`}>
      {items.map((v) => (
        <div class="text-center">
          <div class="text-4xl">{v.icon}</div>
          <h3 class="mt-3 font-heading text-xl font-semibold text-primary">{v.headline}</h3>
          <p class="mt-2 text-secondary">{v.body}</p>
        </div>
      ))}
    </div>
  </Container>
</section>
```

`sections/FeatureGrid.astro`:
```astro
---
import Container from "../ui/Container.astro";
import SectionHeading from "../ui/SectionHeading.astro";
import type { Feature } from "../../types/gym-content";
const { items, headline } = Astro.props as { items: Feature[]; headline: string };
---
<section class="bg-slate-50 py-16">
  <Container>
    <SectionHeading title={headline} />
    <div class="grid grid-cols-2 gap-6 sm:grid-cols-3">
      {items.map((f) => (
        <div class="flex items-center gap-3 rounded-lg bg-white p-4 shadow-sm">
          <span class="text-2xl">{f.icon}</span>
          <span class="font-heading font-medium text-primary">{f.label}</span>
        </div>
      ))}
    </div>
  </Container>
</section>
```

`sections/ProgramCards.astro`:
```astro
---
import Container from "../ui/Container.astro";
import SectionHeading from "../ui/SectionHeading.astro";
import { content, programBySlug } from "../../lib/content";
const { slugs, headline } = Astro.props as { slugs: string[]; headline: string };
const programs = slugs.map(programBySlug);
const promo = content.business.trialCta;
---
<section class="py-16">
  <Container>
    <SectionHeading title={headline} />
    {promo && (
      <p class="mb-8 text-center">
        <a href={promo.url} data-track="trial" class="inline-block rounded-full bg-accent px-4 py-1 text-sm font-semibold text-white">{promo.label}</a>
      </p>
    )}
    <div class="grid gap-8 sm:grid-cols-3">
      {programs.map((p) => (
        <a href={`/programs/${p.slug}`} class="group overflow-hidden rounded-xl shadow transition hover:shadow-lg">
          <img src={p.coverImageUrl} alt={p.name} width="800" height="600" loading="lazy" class="aspect-[4/3] w-full object-cover" />
          <div class="p-5">
            <h3 class="font-heading text-xl font-semibold text-primary group-hover:text-accent">{p.name}</h3>
            <p class="mt-2 text-sm text-secondary">{p.shortDescription}</p>
            <span class="mt-3 inline-block font-semibold text-accent">Learn more →</span>
          </div>
        </a>
      ))}
    </div>
  </Container>
</section>
```

`sections/HowItWorks.astro`:
```astro
---
import Container from "../ui/Container.astro";
import SectionHeading from "../ui/SectionHeading.astro";
import type { Step } from "../../types/gym-content";
const { steps, headline } = Astro.props as { steps: Step[]; headline: string };
---
<section class="bg-slate-50 py-16">
  <Container>
    <SectionHeading title={headline} />
    <ol class="grid gap-8 sm:grid-cols-3">
      {steps.map((s) => (
        <li class="text-center">
          <span class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent font-heading text-xl font-bold text-white">{s.number}</span>
          <h3 class="mt-4 font-heading text-lg font-semibold text-primary">{s.headline}</h3>
          <p class="mt-2 text-secondary">{s.body}</p>
        </li>
      ))}
    </ol>
  </Container>
</section>
```

`sections/Testimonials.astro`:
```astro
---
import Container from "../ui/Container.astro";
import type { Testimonial } from "../../types/gym-content";
const { items } = Astro.props as { items: Testimonial[] };
---
{items.length > 0 && (
  <section class="py-16">
    <Container>
      <div class="grid gap-8 sm:grid-cols-2">
        {items.map((t) => (
          <figure class="rounded-xl bg-slate-50 p-6">
            <blockquote class="text-lg text-primary">“{t.quote}”</blockquote>
            <figcaption class="mt-4 text-sm font-semibold text-secondary">
              {t.name}{t.program && <span class="font-normal"> · {t.program}</span>}
            </figcaption>
          </figure>
        ))}
      </div>
    </Container>
  </section>
)}
```

`sections/FAQ.astro`:
```astro
---
import Container from "../ui/Container.astro";
import SectionHeading from "../ui/SectionHeading.astro";
import FAQSchema from "../seo/FAQSchema.astro";
import type { FAQItem } from "../../types/gym-content";
const { items, headline = "Questions? We have the answers." } = Astro.props as { items: FAQItem[]; headline?: string };
---
{items.length > 0 && (
  <section class="py-16">
    <Container>
      <SectionHeading title={headline} />
      <div class="mx-auto max-w-3xl divide-y divide-slate-200">
        {items.map((f) => (
          <details class="faq-item py-4">
            <summary class="cursor-pointer font-heading font-semibold text-primary">{f.question}</summary>
            <p class="mt-2 text-secondary">{f.answer}</p>
          </details>
        ))}
      </div>
    </Container>
    <FAQSchema items={items} />
  </section>
)}
```

`seo/FAQSchema.astro`:
```astro
---
import type { FAQItem } from "../../types/gym-content";
const { items } = Astro.props as { items: FAQItem[] };
const schema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((f) => ({
    "@type": "Question", name: f.question,
    acceptedAnswer: { "@type": "Answer", text: f.answer },
  })),
};
---
<script type="application/ld+json" set:html={JSON.stringify(schema)} />
```

`sections/CTABand.astro`:
```astro
---
import Button from "../ui/Button.astro";
const { headline, ctaLabel, ctaUrl } = Astro.props as { headline: string; ctaLabel?: string; ctaUrl?: string };
---
<section class="bg-primary py-14 text-center text-white">
  <h2 class="font-heading text-3xl font-bold">{headline}</h2>
  {ctaLabel && ctaUrl && <div class="mt-6"><Button href={ctaUrl} track="contact">{ctaLabel}</Button></div>}
</section>
```

`sections/Location.astro`:
```astro
---
import Container from "../ui/Container.astro";
import { content } from "../../lib/content";
const { business } = content;
const mapsQuery = encodeURIComponent(`${business.name} ${business.address.street} ${business.address.city} ${business.geo.stateAbbr}`);
const directions = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
const areaCopy = business.serviceArea?.length
  ? `${business.name} is located in ${business.geo.city}, ${business.geo.state}, and serves members from nearby communities including ${business.serviceArea.join(", ")}.`
  : `${business.name} is located in ${business.geo.city}, ${business.geo.state}.`;
---
<section class="bg-slate-50 py-16">
  <Container>
    <div class="grid items-center gap-10 lg:grid-cols-2">
      <div>
        <h2 class="font-heading text-3xl font-bold text-primary">Find us in {business.geo.city}</h2>
        <p class="mt-4 text-secondary">{areaCopy}</p>
        <address class="mt-4 not-italic font-semibold text-primary">{business.address.street}, {business.address.city}, {business.geo.stateAbbr} {business.address.zip}</address>
        <p class="mt-2"><a href={`tel:${business.phone.replace(/[^0-9+]/g, "")}`} class="text-accent">{business.phone}</a></p>
        <a href={directions} rel="noopener" class="mt-4 inline-block font-semibold text-accent">Get directions →</a>
      </div>
      {business.mapEmbedUrl && (
        <iframe src={business.mapEmbedUrl} title={`Map to ${business.name}`} width="600" height="400" loading="lazy" class="h-80 w-full rounded-xl border-0" referrerpolicy="no-referrer-when-downgrade"></iframe>
      )}
    </div>
  </Container>
</section>
```

`pages/index.astro` (replace):
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import Hero from "../components/sections/Hero.astro";
import ValueProps from "../components/sections/ValueProps.astro";
import FeatureGrid from "../components/sections/FeatureGrid.astro";
import ProgramCards from "../components/sections/ProgramCards.astro";
import HowItWorks from "../components/sections/HowItWorks.astro";
import Testimonials from "../components/sections/Testimonials.astro";
import FAQ from "../components/sections/FAQ.astro";
import CTABand from "../components/sections/CTABand.astro";
import Location from "../components/sections/Location.astro";
import { content, geoTitle } from "../lib/content";
const home = content.pages.home;
const { business } = content;
---
<GymLayout title={geoTitle("CrossFit, Bootcamp & Personal Training")} description={home.hero.subheading} path="/" image={home.hero.backgroundImageUrl}>
  <Hero hero={home.hero} />
  <ValueProps items={home.valueProps} />
  <ProgramCards slugs={home.featuredPrograms} headline={home.programsHeadline} />
  <HowItWorks steps={home.howItWorks} headline={home.howItWorksHeadline} />
  <FeatureGrid items={home.features} headline="Everything you need to crush your fitness goals" />
  <ValueProps items={home.communityProps} headline={home.communityHeadline} />
  <CTABand headline={home.trustHeadline} />
  <Testimonials items={home.testimonials} />
  <Location />
  <FAQ items={home.faq} />
  <CTABand headline="The hardest step is always the first step." ctaLabel={business.primaryCta.label} ctaUrl={business.primaryCta.url} />
</GymLayout>
```

- [ ] **Step 4: Run** — Expected: all pass. Then eyeball it: `pnpm use:fixture && pnpm dev` → http://localhost:4321

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): full homepage — hero, value props, programs, steps, features, community, testimonials, FAQ+schema, location"
```

---

## Task 8: RichContent + block components

**Files:**
- Create: `apps/renderer/src/components/sections/RichContent.astro`
- Create: `apps/renderer/src/components/blocks/Block.astro`
- Modify: `apps/renderer/test/dist.spec.ts` (assertions land with the local-guide page in Task 12 — this task only needs build to stay green)

- [ ] **Step 1: Implement**

`blocks/Block.astro` — one component, switches on the discriminated union (keeps the block set in one readable file):
```astro
---
import type { ContentBlock } from "../../types/gym-content";
const { block } = Astro.props as { block: ContentBlock };
const calloutCls = { info: "border-sky-400 bg-sky-50", warning: "border-amber-400 bg-amber-50", tip: "border-emerald-400 bg-emerald-50" };
---
{block.type === "text" && <div class="prose max-w-none" set:html={block.html} />}
{block.type === "image" && (
  <figure>
    <img src={block.url} alt={block.alt} width={block.width} height={block.height} loading="lazy" class="rounded-lg" />
    {block.caption && <figcaption class="mt-2 text-sm text-secondary">{block.caption}</figcaption>}
  </figure>
)}
{block.type === "video" && <video src={block.url} poster={block.poster} controls preload="none" class="w-full rounded-lg"></video>}
{block.type === "callout" && <div class={`rounded-lg border-l-4 p-4 ${calloutCls[block.style]}`}>{block.text}</div>}
{block.type === "embed" && <div set:html={block.html} />}
{block.type === "columns" && (
  <div class={`grid gap-6 ${block.columns.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
    {block.columns.map((col) => <div class="space-y-4">{col.map((b) => <Astro.self block={b} />)}</div>)}
  </div>
)}
```
(Note: the ternary uses complete literal class strings deliberately — Tailwind's scanner cannot see dynamically-constructed class names like `sm:grid-cols-${n}`.)

`sections/RichContent.astro`:
```astro
---
import Container from "../ui/Container.astro";
import Block from "../blocks/Block.astro";
import type { RichContentSection } from "../../types/gym-content";
const { sections } = Astro.props as { sections: RichContentSection[] };
---
{sections.map((s) => (
  <section class="py-10">
    <Container>
      {s.headline && <h2 class="mb-6 font-heading text-2xl font-bold text-primary">{s.headline}</h2>}
      <div class="space-y-6">{s.blocks.map((b) => <Block block={b} />)}</div>
    </Container>
  </section>
))}
```

Note: `prose` classes require no plugin to build (they just won't style richly without @tailwindcss/typography). Install it for real styling:
Run from `apps/renderer/`: `pnpm add -D @tailwindcss/typography` and add `plugins: [require("@tailwindcss/typography")]`... ESM config — use:
```javascript
import typography from "@tailwindcss/typography";
// in config object:
plugins: [typography],
```

- [ ] **Step 2: Run `pnpm test`** — Expected: still green (existing suites unaffected, build compiles new components).

- [ ] **Step 3: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): RichContent section with typed block union (text/image/video/columns/callout/embed)"
```

---

## Task 9: Program pages + Service schema

**Files:**
- Create: `apps/renderer/src/components/seo/ServiceSchema.astro`
- Create: `apps/renderer/src/pages/programs/[slug].astro`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Failing tests** (append)

```typescript
describe("program pages", () => {
  it("builds one page per program with geo headline and geo title", () => {
    for (const p of gym.pages.programs) {
      const $ = loadPage(`programs/${p.slug}/index.html`);
      expect($("h1").text()).toContain(`${p.name} in ${gym.business.geo.city}, ${gym.business.geo.stateAbbr}`);
      expect($("title").text()).toContain(gym.business.geo.city);
    }
  });

  it("emits Service + BreadcrumbList schema on program pages", () => {
    const $ = loadPage("programs/crossfit-classes/index.html");
    const schemas = jsonLd($);
    const service = schemas.find((s) => s["@type"] === "Service") as any;
    expect(service.name).toBe("CrossFit Classes");
    expect(service.areaServed.map((a: any) => a.name)).toContain("Leawood");
    const crumbs = schemas.find((s) => s["@type"] === "BreadcrumbList") as any;
    expect(crumbs.itemListElement[1].name).toBe("CrossFit Classes");
  });

  it("renders differentiators, class structure, and program FAQ with schema", () => {
    const $ = loadPage("programs/crossfit-classes/index.html");
    const prog = gym.pages.programs[0];
    for (const d of prog.whatMakesUsDifferent) expect($("body").text()).toContain(d);
    for (const s of prog.whatToExpect.steps) expect($("body").text()).toContain(s);
    expect(jsonLd($).some((s) => s["@type"] === "FAQPage")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL (pages don't exist).

- [ ] **Step 3: Implement**

`seo/ServiceSchema.astro`:
```astro
---
import { content } from "../../lib/content";
const { name, path } = Astro.props as { name: string; path: string };
const { business, meta } = content;
const schema = {
  "@context": "https://schema.org",
  "@type": "Service",
  name,
  serviceType: name,
  provider: { "@type": "LocalBusiness", name: business.name },
  areaServed: [business.geo.city, ...(business.serviceArea ?? [])].map((c) => ({ "@type": "City", name: c })),
  url: `${meta.siteUrl}${path}`,
};
---
<script type="application/ld+json" set:html={JSON.stringify(schema)} />
```

`pages/programs/[slug].astro`:
```astro
---
import GymLayout from "../../layouts/GymLayout.astro";
import Hero from "../../components/sections/Hero.astro";
import HowItWorks from "../../components/sections/HowItWorks.astro";
import Testimonials from "../../components/sections/Testimonials.astro";
import FAQ from "../../components/sections/FAQ.astro";
import CTABand from "../../components/sections/CTABand.astro";
import Location from "../../components/sections/Location.astro";
import RichContent from "../../components/sections/RichContent.astro";
import ServiceSchema from "../../components/seo/ServiceSchema.astro";
import BreadcrumbSchema from "../../components/seo/BreadcrumbSchema.astro";
import Container from "../../components/ui/Container.astro";
import SectionHeading from "../../components/ui/SectionHeading.astro";
import { content, programGeoHeadline } from "../../lib/content";

export function getStaticPaths() {
  return content.pages.programs.map((p) => ({ params: { slug: p.slug }, props: { program: p } }));
}
const { program } = Astro.props;
const { business } = content;
const path = `/programs/${program.slug}`;
const headline = programGeoHeadline(program);
const title = `${program.name} in ${business.geo.city}, ${business.geo.stateAbbr} | ${business.name}`;
---
<GymLayout title={title} description={program.shortDescription} path={path} image={program.coverImageUrl}>
  <Fragment slot="head">
    <ServiceSchema name={program.name} path={path} />
    <BreadcrumbSchema crumbs={[{ name: program.name, path }]} />
  </Fragment>

  <!-- Geo H1 above the hero band for local SEO, hero renders as h2 -->
  <Container><h1 class="pt-10 text-center font-heading text-2xl font-semibold text-secondary">{headline}</h1></Container>
  <Hero hero={program.hero} h1={false} />

  <section class="py-16">
    <Container>
      <SectionHeading title={program.whatIsIt.headline} />
      <p class="mx-auto max-w-3xl text-center text-lg text-secondary">{program.whatIsIt.body}</p>
    </Container>
  </section>

  <section class="bg-slate-50 py-16">
    <Container>
      <SectionHeading title={`What makes our ${program.name} different?`} />
      <ul class="mx-auto max-w-2xl space-y-3">
        {program.whatMakesUsDifferent.map((d) => (
          <li class="flex gap-3"><span class="text-accent">✔</span><span>{d}</span></li>
        ))}
      </ul>
    </Container>
  </section>

  <section class="py-16">
    <Container>
      <SectionHeading title={program.whatToExpect.headline} />
      <ol class="mx-auto flex max-w-3xl flex-wrap justify-center gap-4">
        {program.whatToExpect.steps.map((s, i) => (
          <li class="rounded-full bg-primary px-5 py-2 font-heading text-white">{i + 1}. {s}</li>
        ))}
      </ol>
    </Container>
  </section>

  <section class="bg-slate-50 py-16">
    <Container>
      <SectionHeading title={`Who is ${program.name} for?`} />
      <ul class="mx-auto max-w-2xl list-disc space-y-2 pl-6 text-secondary">
        {program.whoIsItFor.map((w) => <li>{w}</li>)}
      </ul>
    </Container>
  </section>

  <HowItWorks steps={program.gettingStarted} headline="Getting started" />
  <Testimonials items={program.testimonials} />
  {program.richContent && <RichContent sections={program.richContent} />}
  <Location />
  <FAQ items={program.faq} />
  <CTABand headline="The hardest step is always the first step." ctaLabel={business.primaryCta.label} ctaUrl={business.primaryCta.url} />
</GymLayout>
```

- [ ] **Step 4: Run** — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): program pages — geo headline, Service+Breadcrumb schema, full section stack"
```

---

## Task 10: About, Contact, Schedule pages

**Files:**
- Create: `apps/renderer/src/components/sections/TeamGrid.astro`
- Create: `apps/renderer/src/components/forms/LeadForm.astro`
- Create: `apps/renderer/src/pages/about.astro`
- Create: `apps/renderer/src/pages/contact.astro`
- Create: `apps/renderer/src/pages/schedule.astro`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Failing tests** (append)

```typescript
describe("about / contact / schedule", () => {
  it("about renders every team member", () => {
    const $ = loadPage("about/index.html");
    for (const m of gym.pages.about.team) {
      expect($("body").text()).toContain(m.name);
      expect($("body").text()).toContain(m.title);
    }
  });

  it("contact has a lead form posting to the API forms endpoint with honeypot", () => {
    const $ = loadPage("contact/index.html");
    const form = $("form[data-lead-form]");
    expect(form.attr("action")).toBe(`${gym.meta.apiBaseUrl}/api/forms/${gym.meta.siteId}/contact`);
    expect(form.attr("method")).toBe("post");
    expect(form.find('input[name="_hp"]').length).toBe(1);
    expect(form.find('input[name="email"]').length).toBe(1);
  });

  it("schedule embeds the booking widget html", () => {
    const $ = loadPage("schedule/index.html");
    expect($("#fixture-booking-widget").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

`sections/TeamGrid.astro`:
```astro
---
import Container from "../ui/Container.astro";
import SectionHeading from "../ui/SectionHeading.astro";
import type { TeamMember } from "../../types/gym-content";
const { team } = Astro.props as { team: TeamMember[] };
---
<section class="py-16">
  <Container>
    <SectionHeading title="Our coaching team" />
    <div class="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-4">
      {team.map((m) => (
        <div class="text-center">
          <img src={m.photoUrl} alt={m.name} width="400" height="400" loading="lazy" class="aspect-square w-full rounded-xl object-cover" />
          <h3 class="mt-3 font-heading font-semibold text-primary">{m.name}</h3>
          <p class="text-sm text-secondary">{m.title}</p>
          {m.bio && <p class="mt-1 text-sm text-secondary">{m.bio}</p>}
        </div>
      ))}
    </div>
  </Container>
</section>
```

`forms/LeadForm.astro` — the capture contract. Plain HTML form; UTM hidden fields are injected by `utm-tracker.js`; honeypot matches the API's `_hp` convention; success state read from `?submitted=1`:
```astro
---
import { content } from "../../lib/content";
const { formId, submitLabel = "Send", includeMessage = true } = Astro.props as { formId: string; submitLabel?: string; includeMessage?: boolean };
const { meta } = content;
const action = `${meta.apiBaseUrl}/api/forms/${meta.siteId}/${formId}`;
---
<div class="mx-auto max-w-lg">
  <p data-form-success class="mb-4 hidden rounded-lg bg-emerald-50 p-4 text-emerald-800">Thanks — we got it. We'll be in touch shortly.</p>
  <form data-lead-form action={action} method="post" class="space-y-4">
    <input type="text" name="_hp" value="" tabindex="-1" autocomplete="off" aria-hidden="true" class="hidden" />
    <label class="block">
      <span class="font-heading text-sm font-semibold text-primary">Name</span>
      <input required type="text" name="name" class="mt-1 w-full rounded-lg border border-slate-300 p-3" />
    </label>
    <label class="block">
      <span class="font-heading text-sm font-semibold text-primary">Email</span>
      <input required type="email" name="email" class="mt-1 w-full rounded-lg border border-slate-300 p-3" />
    </label>
    <label class="block">
      <span class="font-heading text-sm font-semibold text-primary">Phone</span>
      <input type="tel" name="phone" class="mt-1 w-full rounded-lg border border-slate-300 p-3" />
    </label>
    {includeMessage && (
      <label class="block">
        <span class="font-heading text-sm font-semibold text-primary">Message</span>
        <textarea name="message" rows="4" class="mt-1 w-full rounded-lg border border-slate-300 p-3"></textarea>
      </label>
    )}
    <button type="submit" class="w-full rounded-lg bg-accent px-6 py-3 font-heading font-semibold text-white">{submitLabel}</button>
  </form>
</div>
<script is:inline>
  if (new URLSearchParams(location.search).get("submitted") === "1") {
    document.querySelectorAll("[data-form-success]").forEach(function (el) { el.classList.remove("hidden"); });
  }
</script>
```

`pages/about.astro`:
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import Hero from "../components/sections/Hero.astro";
import TeamGrid from "../components/sections/TeamGrid.astro";
import CTABand from "../components/sections/CTABand.astro";
import RichContent from "../components/sections/RichContent.astro";
import BreadcrumbSchema from "../components/seo/BreadcrumbSchema.astro";
import Container from "../components/ui/Container.astro";
import { content } from "../lib/content";
const about = content.pages.about;
const { business } = content;
const title = `About ${business.name} | Gym in ${business.geo.city}, ${business.geo.stateAbbr}`;
---
<GymLayout title={title} description={about.gymStory.slice(0, 155)} path="/about" image={about.hero.backgroundImageUrl}>
  <Fragment slot="head"><BreadcrumbSchema crumbs={[{ name: "About", path: "/about" }]} /></Fragment>
  <Hero hero={about.hero} />
  <section class="py-16"><Container><p class="mx-auto max-w-3xl text-center text-lg text-secondary">{about.gymStory}</p></Container></section>
  <TeamGrid team={about.team} />
  {about.richContent && <RichContent sections={about.richContent} />}
  <CTABand headline="The hardest step is always the first step." ctaLabel={business.primaryCta.label} ctaUrl={business.primaryCta.url} />
</GymLayout>
```

`pages/contact.astro`:
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import Hero from "../components/sections/Hero.astro";
import Location from "../components/sections/Location.astro";
import LeadForm from "../components/forms/LeadForm.astro";
import BreadcrumbSchema from "../components/seo/BreadcrumbSchema.astro";
import Container from "../components/ui/Container.astro";
import { content } from "../lib/content";
const c = content.pages.contact;
const { business } = content;
const title = `Contact ${business.name} | Gym in ${business.geo.city}, ${business.geo.stateAbbr}`;
---
<GymLayout title={title} description={c.hero.subheading ?? business.tagline} path="/contact">
  <Fragment slot="head"><BreadcrumbSchema crumbs={[{ name: "Contact", path: "/contact" }]} /></Fragment>
  <Hero hero={c.hero} />
  <section class="py-16">
    <Container>
      {c.intro && <p class="mb-8 text-center text-secondary">{c.intro}</p>}
      <LeadForm formId="contact" submitLabel="Send message" />
    </Container>
  </section>
  <Location />
</GymLayout>
```

`pages/schedule.astro`:
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import Hero from "../components/sections/Hero.astro";
import CTABand from "../components/sections/CTABand.astro";
import BreadcrumbSchema from "../components/seo/BreadcrumbSchema.astro";
import Container from "../components/ui/Container.astro";
import { content } from "../lib/content";
const s = content.pages.schedule;
const { business } = content;
const title = `Class Schedule | ${business.name} in ${business.geo.city}, ${business.geo.stateAbbr}`;
---
<GymLayout title={title} description={s.hero.subheading ?? `Class schedule at ${business.name}`} path="/schedule">
  <Fragment slot="head"><BreadcrumbSchema crumbs={[{ name: "Schedule", path: "/schedule" }]} /></Fragment>
  <Hero hero={s.hero} />
  <section class="py-16">
    <Container>
      {s.widgetEmbedHtml && <div set:html={s.widgetEmbedHtml} />}
      {s.note && <p class="mt-6 text-center text-secondary">{s.note}</p>}
    </Container>
  </section>
  <CTABand headline="First time?" ctaLabel={business.primaryCta.label} ctaUrl={business.primaryCta.url} />
</GymLayout>
```

- [ ] **Step 4: Run** — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): about (team grid), contact (lead form + UTM contract), schedule (booking widget embed)"
```

---

## Task 11: Pricing page — grid + request form

**Files:**
- Create: `apps/renderer/src/components/sections/PricingGrid.astro`
- Create: `apps/renderer/src/pages/pricing.astro`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Failing tests** (append)

```typescript
describe("pricing", () => {
  it("renders all plans with the highlighted plan badged", () => {
    const $ = loadPage("pricing/index.html");
    for (const plan of gym.pages.pricing.grid.plans) {
      expect($("body").text()).toContain(plan.name);
      expect($("body").text()).toContain(plan.price);
    }
    expect($("body").text()).toContain("Most Popular");
  });

  it("renders the rate-sheet request form posting to formId 'pricing'", () => {
    const $ = loadPage("pricing/index.html");
    expect($("form[data-lead-form]").attr("action")).toContain("/forms/");
    expect($("form[data-lead-form]").attr("action")).toMatch(/\/pricing$/);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

`sections/PricingGrid.astro`:
```astro
---
import Container from "../ui/Container.astro";
import SectionHeading from "../ui/SectionHeading.astro";
import Button from "../ui/Button.astro";
import type { PricingGridContent } from "../../types/gym-content";
const { grid } = Astro.props as { grid: PricingGridContent };
---
<section class="py-16">
  <Container>
    {grid.headline && <SectionHeading title={grid.headline} subtitle={grid.subheading} />}
    <div class="grid gap-8 lg:grid-cols-3">
      {grid.plans.map((plan) => (
        <div class={`relative rounded-2xl border p-8 ${plan.highlighted ? "border-accent shadow-xl" : "border-slate-200"}`}>
          {plan.badge && <span class="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1 text-xs font-bold uppercase text-white">{plan.badge}</span>}
          <h3 class="font-heading text-xl font-semibold text-primary">{plan.name}</h3>
          <p class="mt-4"><span class="font-heading text-4xl font-bold text-primary">{plan.price}</span>{plan.period && <span class="text-secondary">{plan.period}</span>}</p>
          {plan.description && <p class="mt-2 text-sm text-secondary">{plan.description}</p>}
          <ul class="mt-6 space-y-2 text-sm">
            {plan.features.map((f) => <li class="flex gap-2"><span class="text-accent">✔</span>{f}</li>)}
          </ul>
          <div class="mt-8"><Button href={plan.cta.url} variant={plan.highlighted ? "primary" : "outline"} track="trial">{plan.cta.label}</Button></div>
        </div>
      ))}
    </div>
  </Container>
</section>
```

`pages/pricing.astro`:
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import Hero from "../components/sections/Hero.astro";
import PricingGrid from "../components/sections/PricingGrid.astro";
import LeadForm from "../components/forms/LeadForm.astro";
import CTABand from "../components/sections/CTABand.astro";
import BreadcrumbSchema from "../components/seo/BreadcrumbSchema.astro";
import Container from "../components/ui/Container.astro";
import SectionHeading from "../components/ui/SectionHeading.astro";
import { content } from "../lib/content";
const p = content.pages.pricing;
const { business } = content;
const title = `Membership Pricing | ${business.name} in ${business.geo.city}, ${business.geo.stateAbbr}`;
---
<GymLayout title={title} description={p.hero.subheading ?? `Membership pricing at ${business.name}`} path="/pricing">
  <Fragment slot="head"><BreadcrumbSchema crumbs={[{ name: "Pricing", path: "/pricing" }]} /></Fragment>
  <Hero hero={p.hero} />
  {p.grid && <PricingGrid grid={p.grid} />}
  {p.form && (
    <section class="bg-slate-50 py-16">
      <Container>
        <SectionHeading title={p.form.headline} subtitle={p.form.intro} />
        <LeadForm formId="pricing" submitLabel="Send me the rates" includeMessage={false} />
      </Container>
    </section>
  )}
  <CTABand headline="Not sure which plan? Talk to a coach." ctaLabel={business.primaryCta.label} ctaUrl={business.primaryCta.url} />
</GymLayout>
```

- [ ] **Step 4: Run** — Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): pricing page — plan grid with highlight/badge + rate-sheet lead form"
```

---

## Task 12: Blog (markdown), local guide, legal pages, 404, RSS

**Files:**
- Modify: `apps/renderer/package.json` (add `marked`)
- Create: `apps/renderer/src/components/seo/BlogPostingSchema.astro`
- Create: `apps/renderer/src/pages/blog/index.astro`
- Create: `apps/renderer/src/pages/blog/[slug].astro`
- Create: `apps/renderer/src/pages/local-guide.astro`
- Create: `apps/renderer/src/pages/legal/[slug].astro`
- Create: `apps/renderer/src/pages/404.astro`
- Create: `apps/renderer/src/pages/rss.xml.ts`
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Install** — from `apps/renderer/`: `pnpm add marked`

- [ ] **Step 2: Failing tests** (append)

```typescript
describe("blog + wells + utility pages", () => {
  it("blog index lists every post with category labels", () => {
    const $ = loadPage("blog/index.html");
    for (const post of gym.pages.blog.posts) {
      expect($("body").text()).toContain(post.title);
      expect($(`a[href="/blog/${post.slug}"]`).length).toBeGreaterThan(0);
    }
    expect($("body").text()).toContain("Education");
  });

  it("blog post renders markdown body and BlogPosting schema", () => {
    const post = gym.pages.blog.posts[0];
    const $ = loadPage(`blog/${post.slug}/index.html`);
    expect($("h2").text()).toContain("Why now?");           // from markdown ##
    expect($("article img").length).toBeGreaterThan(0);      // markdown image
    const schema = jsonLd($).find((s) => s["@type"] === "BlogPosting") as any;
    expect(schema.headline).toBe(post.title);
    expect(schema.datePublished).toBe(post.publishedAt);
  });

  it("local guide renders rich content sections", () => {
    const $ = loadPage("local-guide/index.html");
    for (const s of gym.pages.localGuide.sections) expect($("body").text()).toContain(s.headline);
  });

  it("legal pages and 404 exist", () => {
    expect(distExists("legal/privacy-policy/index.html")).toBe(true);
    expect(distExists("legal/terms-of-use/index.html")).toBe(true);
    expect(distExists("404.html")).toBe(true);
  });

  it("rss.xml lists blog posts", () => {
    const xml = readDist("rss.xml");
    expect(xml).toContain("<rss");
    expect(xml).toContain(gym.pages.blog.posts[0].title);
  });
});
```
Add `distExists` to the helpers import.

- [ ] **Step 3: Run** — Expected: FAIL.

- [ ] **Step 4: Implement**

`seo/BlogPostingSchema.astro`:
```astro
---
import { content } from "../../lib/content";
import type { BlogPost } from "../../types/gym-content";
const { post } = Astro.props as { post: BlogPost };
const schema = {
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  headline: post.title,
  datePublished: post.publishedAt,
  description: post.excerpt,
  ...(post.author && { author: { "@type": "Person", name: post.author } }),
  publisher: { "@type": "Organization", name: content.business.name },
  url: `${content.meta.siteUrl}/blog/${post.slug}`,
  ...(post.coverImageUrl && { image: post.coverImageUrl }),
};
---
<script type="application/ld+json" set:html={JSON.stringify(schema)} />
```

`pages/blog/index.astro`:
```astro
---
import GymLayout from "../../layouts/GymLayout.astro";
import BreadcrumbSchema from "../../components/seo/BreadcrumbSchema.astro";
import Container from "../../components/ui/Container.astro";
import { content } from "../../lib/content";
const { blog } = content.pages;
const { business } = content;
const posts = [...blog.posts].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
const title = `Fitness Tips & News | ${business.name} Blog`;
---
<GymLayout title={title} description={`Fitness tips, local guides, and news from ${business.name}.`} path="/blog">
  <Fragment slot="head"><BreadcrumbSchema crumbs={[{ name: "Blog", path: "/blog" }]} /></Fragment>
  <section class="py-16">
    <Container>
      <h1 class="mb-10 text-center font-heading text-4xl font-bold text-primary">{blog.heroHeadline}</h1>
      <div class="mx-auto max-w-2xl space-y-10">
        {posts.map((post) => (
          <article class="overflow-hidden rounded-xl shadow">
            {post.coverImageUrl && (
              <a href={`/blog/${post.slug}`}><img src={post.coverImageUrl} alt={post.title} width="1200" height="630" loading="lazy" class="aspect-[1.91/1] w-full object-cover" /></a>
            )}
            <div class="p-6">
              {post.category && <span class="text-xs font-bold uppercase tracking-wide text-accent">{post.category}</span>}
              <h2 class="mt-1 font-heading text-2xl font-semibold text-primary"><a href={`/blog/${post.slug}`}>{post.title}</a></h2>
              <p class="mt-2 text-secondary">{post.excerpt}</p>
              <a href={`/blog/${post.slug}`} class="mt-3 inline-block font-semibold text-accent">Read more →</a>
            </div>
          </article>
        ))}
      </div>
    </Container>
  </section>
</GymLayout>
```

`pages/blog/[slug].astro`:
```astro
---
import { marked } from "marked";
import GymLayout from "../../layouts/GymLayout.astro";
import BlogPostingSchema from "../../components/seo/BlogPostingSchema.astro";
import BreadcrumbSchema from "../../components/seo/BreadcrumbSchema.astro";
import CTABand from "../../components/sections/CTABand.astro";
import Container from "../../components/ui/Container.astro";
import { content } from "../../lib/content";

export function getStaticPaths() {
  return content.pages.blog.posts.map((post) => ({ params: { slug: post.slug }, props: { post } }));
}
const { post } = Astro.props;
const { business } = content;
const body = marked.parse(post.body) as string;
const path = `/blog/${post.slug}`;
---
<GymLayout title={`${post.title} | ${business.name}`} description={post.excerpt} path={path} image={post.coverImageUrl}>
  <Fragment slot="head">
    <BlogPostingSchema post={post} />
    <BreadcrumbSchema crumbs={[{ name: "Blog", path: "/blog" }, { name: post.title, path }]} />
  </Fragment>
  <article class="py-16">
    <Container>
      <div class="mx-auto max-w-2xl">
        {post.category && <span class="text-xs font-bold uppercase tracking-wide text-accent">{post.category}</span>}
        <h1 class="mt-1 font-heading text-4xl font-bold text-primary">{post.title}</h1>
        <p class="mt-2 text-sm text-secondary">
          <time datetime={post.publishedAt}>{new Date(post.publishedAt + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</time>
          {post.author && <span> · {post.author}</span>}
        </p>
        {post.coverImageUrl && <img src={post.coverImageUrl} alt={post.title} width="1200" height="630" loading="eager" class="mt-6 rounded-xl" />}
        <div class="prose mt-8 max-w-none" set:html={body} />
      </div>
    </Container>
  </article>
  <CTABand headline={`Train with us in ${business.geo.city}`} ctaLabel={business.primaryCta.label} ctaUrl={business.primaryCta.url} />
</GymLayout>
```

`pages/local-guide.astro`:
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import Hero from "../components/sections/Hero.astro";
import RichContent from "../components/sections/RichContent.astro";
import CTABand from "../components/sections/CTABand.astro";
import BreadcrumbSchema from "../components/seo/BreadcrumbSchema.astro";
import { content } from "../lib/content";
const guide = content.pages.localGuide;
const { business } = content;
---
{guide && (
  <GymLayout title={`${business.geo.city} Local Guide | ${business.name}`} description={guide.hero.subheading ?? `The ${business.geo.city} local guide by ${business.name}.`} path="/local-guide">
    <Fragment slot="head"><BreadcrumbSchema crumbs={[{ name: "Local Guide", path: "/local-guide" }]} /></Fragment>
    <Hero hero={guide.hero} />
    <RichContent sections={guide.sections} />
    <CTABand headline={`New to ${business.geo.city}? Come train with us.`} ctaLabel={business.primaryCta.label} ctaUrl={business.primaryCta.url} />
  </GymLayout>
)}
```
Note: if `localGuide` is absent from content, this page renders empty — acceptable for 2a (the route only gets linked when content exists). If Astro errors on an empty top-level expression, guard with an early redirect instead; keep the simplest form that builds.

`pages/legal/[slug].astro`:
```astro
---
import GymLayout from "../../layouts/GymLayout.astro";
import Block from "../../components/blocks/Block.astro";
import Container from "../../components/ui/Container.astro";
import { content } from "../../lib/content";
export function getStaticPaths() {
  return content.pages.legal.map((page) => ({ params: { slug: page.slug }, props: { page } }));
}
const { page } = Astro.props;
const { business } = content;
---
<GymLayout title={`${page.title} | ${business.name}`} description={page.title} path={`/legal/${page.slug}`}>
  <section class="py-16"><Container>
    <h1 class="mb-8 font-heading text-3xl font-bold text-primary">{page.title}</h1>
    <div class="space-y-6">{page.blocks.map((b) => <Block block={b} />)}</div>
  </Container></section>
</GymLayout>
```

`pages/404.astro`:
```astro
---
import GymLayout from "../layouts/GymLayout.astro";
import Button from "../components/ui/Button.astro";
import { content } from "../lib/content";
const { business } = content;
---
<GymLayout title={`Page not found | ${business.name}`} description="That page has moved or never existed." path="/404">
  <section class="py-24 text-center">
    <h1 class="font-heading text-5xl font-bold text-primary">404</h1>
    <p class="mt-4 text-lg text-secondary">That page has moved or never existed — but the workouts are still here.</p>
    <div class="mt-8 flex justify-center gap-4">
      <Button href="/">Back home</Button>
      <Button href={business.primaryCta.url} variant="outline">{business.primaryCta.label}</Button>
    </div>
  </section>
</GymLayout>
```

`pages/rss.xml.ts`:
```typescript
import type { APIRoute } from "astro";
import { content } from "../lib/content";

export const GET: APIRoute = () => {
  const { meta, business, pages } = content;
  const items = [...pages.blog.posts]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .map((p) => `<item><title><![CDATA[${p.title}]]></title><link>${meta.siteUrl}/blog/${p.slug}</link><guid>${meta.siteUrl}/blog/${p.slug}</guid><pubDate>${new Date(p.publishedAt + "T00:00:00Z").toUTCString()}</pubDate><description><![CDATA[${p.excerpt}]]></description></item>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${business.name} Blog</title><link>${meta.siteUrl}/blog</link><description>${meta.defaultDescription}</description>${items}</channel></rss>`;
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml" } });
};
```

- [ ] **Step 5: Run** — Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): blog with markdown+BlogPosting schema, local guide well, legal pages, 404, RSS"
```

---

## Task 13: sitemap.xml, robots.txt, llms.txt, favicon/webmanifest

**Files:**
- Create: `apps/renderer/src/lib/routes.ts`
- Create: `apps/renderer/src/pages/sitemap.xml.ts`
- Create: `apps/renderer/src/pages/robots.txt.ts`
- Create: `apps/renderer/src/pages/llms.txt.ts`
- Create: `apps/renderer/src/pages/site.webmanifest.ts`
- Modify: `apps/renderer/src/layouts/GymLayout.astro` (favicon + manifest links)
- Modify: `apps/renderer/test/dist.spec.ts`

- [ ] **Step 1: Failing tests** (append)

```typescript
describe("discovery files", () => {
  it("sitemap lists all public routes and no legal/404", () => {
    const xml = readDist("sitemap.xml");
    for (const p of ["/", "/about", "/pricing", "/contact", "/schedule", "/blog", "/local-guide"]) {
      expect(xml).toContain(`<loc>${gym.meta.siteUrl}${p === "/" ? "/" : p}</loc>`);
    }
    expect(xml).toContain(`/programs/crossfit-classes`);
    expect(xml).toContain(`/blog/${gym.pages.blog.posts[0].slug}`);
    expect(xml).not.toContain("/legal/");
  });

  it("robots allows crawling (fixture is not preview) and points at sitemap", () => {
    const txt = readDist("robots.txt");
    expect(txt).toContain("Allow: /");
    expect(txt).toContain(`Sitemap: ${gym.meta.siteUrl}/sitemap.xml`);
  });

  it("llms.txt describes the business, programs, location, and pricing model", () => {
    const txt = readDist("llms.txt");
    expect(txt).toContain(gym.business.name);
    expect(txt).toContain(gym.business.geo.city);
    for (const p of gym.pages.programs) expect(txt).toContain(p.name);
    expect(txt).toContain(gym.pages.home.faq[0].question);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/routes.ts` — single source of truth for public routes:
```typescript
import { content } from "./content";

/** All indexable routes (excludes legal + 404). */
export function publicRoutes(): string[] {
  const { pages } = content;
  return [
    "/",
    ...pages.programs.map((p) => `/programs/${p.slug}`),
    "/about",
    "/pricing",
    "/contact",
    "/schedule",
    "/blog",
    ...pages.blog.posts.map((p) => `/blog/${p.slug}`),
    ...(pages.localGuide ? ["/local-guide"] : []),
  ];
}
```

`pages/sitemap.xml.ts`:
```typescript
import type { APIRoute } from "astro";
import { content } from "../lib/content";
import { publicRoutes } from "../lib/routes";

export const GET: APIRoute = () => {
  const { meta } = content;
  if (meta.preview) {
    return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`, { headers: { "Content-Type": "application/xml" } });
  }
  const urls = publicRoutes().map((p) => `  <url><loc>${meta.siteUrl}${p === "/" ? "/" : p}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
};
```

`pages/robots.txt.ts`:
```typescript
import type { APIRoute } from "astro";
import { content } from "../lib/content";

export const GET: APIRoute = () => {
  const { meta } = content;
  const body = meta.preview
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n\nSitemap: ${meta.siteUrl}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
};
```

`pages/llms.txt.ts` — AEO summary for AI crawlers:
```typescript
import type { APIRoute } from "astro";
import { content } from "../lib/content";

export const GET: APIRoute = () => {
  const { business, meta, pages } = content;
  const hours = business.hours.map((h) => `- ${h.days.join(", ")}: ${h.opens}–${h.closes}`).join("\n");
  const programs = pages.programs.map((p) => `- [${p.name}](${meta.siteUrl}/programs/${p.slug}): ${p.shortDescription}`).join("\n");
  const faq = pages.home.faq.map((f) => `**Q: ${f.question}**\nA: ${f.answer}`).join("\n\n");
  const body = `# ${business.name}

> ${business.tagline}

- Location: ${business.address.street}, ${business.address.city}, ${business.geo.stateAbbr} ${business.address.zip}
- Phone: ${business.phone}
- Service area: ${[business.geo.city, ...(business.serviceArea ?? [])].join(", ")}
- Website: ${meta.siteUrl}

## Hours
${hours}

## Programs
${programs}

## Pricing
${pages.pricing.grid ? pages.pricing.grid.plans.map((p) => `- ${p.name}: ${p.price}${p.period ?? ""}`).join("\n") : "Membership pricing available on request — book a free discovery call."}

## Frequently asked questions
${faq}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
```

`pages/site.webmanifest.ts`:
```typescript
import type { APIRoute } from "astro";
import { content } from "../lib/content";

export const GET: APIRoute = () => {
  const { business, brand } = content;
  return new Response(JSON.stringify({
    name: business.name,
    short_name: business.name,
    icons: [{ src: brand.logoUrl, sizes: "any" }],
    theme_color: brand.primaryColor,
    background_color: "#ffffff",
    display: "browser",
  }), { headers: { "Content-Type": "application/manifest+json" } });
};
```

In `GymLayout.astro` head, add:
```astro
    <link rel="icon" href={brand.logoUrl} />
    <link rel="manifest" href="/site.webmanifest" />
```

- [ ] **Step 4: Run** — Expected: pass. Renderer is now feature-complete.

- [ ] **Step 5: Commit**

```bash
git add apps/renderer
git commit -m "feat(template): sitemap, robots (preview-aware), llms.txt AEO summary, webmanifest + favicon"
```

---

## Task 14: API — public lead capture endpoint (the form contract)

**Files (all under `apps/api/`):**
- Modify: `package.json` (add `@fastify/formbody`)
- Create: `src/services/leads.ts`
- Create: `src/api/routes/forms.ts`
- Modify: `src/api/plugins/workspace.ts` (public exemption)
- Test: `test/leads.test.ts`

- [ ] **Step 1: Install** — from `apps/api/`: `pnpm add @fastify/formbody`

- [ ] **Step 2: Failing service tests** — `test/leads.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/database";
import { setupTestContext } from "./setup";
import { handleFormSubmission } from "../src/services/leads";

describe("handleFormSubmission", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ctx = await setupTestContext();
    workspaceUuid = ctx.workspace.uuid;
    const site = await db.insertInto("sites")
      .values({ workspaceUuid, name: "Test Gym", slug: "test-gym" })
      .returning("uuid").executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  it("stores a lead with fields including utm params, honeypot stripped", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid, formId: "contact",
      fields: { name: "Jo", email: "jo@x.com", utm_source: "facebook", utm_campaign: "spring", _hp: "" },
      sourcePath: "/contact", ip: "1.2.3.4",
    });
    expect(result.stored).toBe(true);
    const lead = await db.selectFrom("leads").selectAll().where("siteUuid", "=", siteUuid).executeTakeFirstOrThrow();
    expect(lead.formId).toBe("contact");
    expect((lead.fields as any).email).toBe("jo@x.com");
    expect((lead.fields as any).utm_source).toBe("facebook");
    expect((lead.fields as any)._hp).toBeUndefined();
  });

  it("silently drops honeypot submissions", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid, formId: "contact", fields: { name: "Bot", _hp: "gotcha" }, sourcePath: "/", ip: "1.2.3.4",
    });
    expect(result.stored).toBe(false);
    expect(await db.selectFrom("leads").selectAll().execute()).toHaveLength(0);
  });

  it("returns stored=false for an unknown site", async () => {
    const result = await handleFormSubmission(db, {
      siteUuid: "00000000-0000-0000-0000-000000000000", formId: "x", fields: {}, sourcePath: null, ip: null,
    });
    expect(result.stored).toBe(false);
  });
});
```

- [ ] **Step 3: Run** — from `apps/api/`: `pnpm test test/leads.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/services/leads.ts`**

```typescript
import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { jsonb } from "../utils/jsonb";

export interface FormSubmission {
  siteUuid: string;
  formId: string;
  fields: Record<string, unknown>;
  sourcePath: string | null;
  ip: string | null;
}

export async function handleFormSubmission(
  db: Kysely<DB>,
  submission: FormSubmission,
): Promise<{ stored: boolean }> {
  const hp = submission.fields["_hp"];
  if (typeof hp === "string" && hp.length > 0) return { stored: false };

  const site = await db.selectFrom("sites")
    .select(["uuid", "workspaceUuid"])
    .where("uuid", "=", submission.siteUuid)
    .executeTakeFirst();
  if (!site) return { stored: false };

  const { _hp, ...fields } = submission.fields;
  void _hp;
  await db.insertInto("leads").values({
    siteUuid: site.uuid,
    workspaceUuid: site.workspaceUuid,
    formId: submission.formId,
    fields: jsonb(fields),
    sourcePath: submission.sourcePath,
    ip: submission.ip,
  }).execute();
  return { stored: true };
}
```

- [ ] **Step 5: Run** — Expected: 3 passing.

- [ ] **Step 6: Route + auth exemption**

In `src/api/plugins/workspace.ts`, inside the `onRequest` hook next to the existing preview exemption, add:
```typescript
      // Public lead capture — hit by anonymous gym-site visitors.
      if (
        request.method === "POST" &&
        /^(\/api)?\/forms\/[^/]+\/[^/]+\/?$/.test(pathname)
      ) {
        return;
      }
```

`src/api/routes/forms.ts`:
```typescript
import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import formbody from "@fastify/formbody";
import { handleFormSubmission } from "../../services/leads";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

// In-memory rate limit — known limitation (single process); Redis-backed limit
// arrives with the forms-as-a-system workstream.
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  void fastify.register(formbody);

  fastify.post(
    "/forms/:siteUuid/:formId",
    {
      schema: {
        params: z.object({ siteUuid: z.string().uuid(), formId: z.string().max(200) }),
      },
    },
    async (request, reply) => {
      const ip = request.ip;
      if (rateLimited(ip)) return reply.code(429).send({ error: "Too many submissions" });

      const { siteUuid, formId } = request.params;
      const fields = (request.body ?? {}) as Record<string, unknown>;
      const referer = typeof request.headers.referer === "string" ? request.headers.referer : null;
      let sourcePath: string | null = null;
      try { sourcePath = referer ? new URL(referer).pathname : null; } catch { /* bad referer */ }

      const result = await handleFormSubmission(fastify.db, { siteUuid, formId, fields, sourcePath, ip });
      if (result.stored) fastify.log.info({ siteUuid, formId }, "lead captured");

      // Behave identically whether stored or honeypot-dropped — don't tip off bots.
      if (referer) {
        try {
          const back = new URL(referer);
          back.searchParams.set("submitted", "1");
          return reply.code(303).redirect(back.toString());
        } catch { /* fall through */ }
      }
      return reply.code(200).send({ ok: true });
    },
  );

  done();
};

export default app;
```

- [ ] **Step 7: Build + commit**

Run from `apps/api/`: `npx tsc --noEmit` — Expected: clean.
```bash
git add apps/api/src/services/leads.ts apps/api/src/api/routes/forms.ts apps/api/src/api/plugins/workspace.ts apps/api/test/leads.test.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(leads): public form capture endpoint — honeypot, UTM fields, rate limit, auth exemption"
```

---

## Task 15: API — site_versions + publish/rollback + mirror = v1

**Files (all under `apps/api/`):**
- Create: `src/migrations/20260705000000_site_versions.ts`
- Modify: `src/types/db.ts` (SiteVersions interface + DB entry)
- Create: `src/services/site-versions.ts`
- Create: `src/api/routes/versions.ts`
- Modify: `src/services/mirror/run-mirror.ts` (record + publish v1)
- Modify: `test/setup.ts` (truncate `site_versions`)
- Test: `test/site-versions.test.ts`

- [ ] **Step 1: Migration**

```typescript
import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("site_versions")
    .addColumn("uuid", "uuid", (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("site_uuid", "uuid", (c) => c.notNull().references("sites.uuid").onDelete("cascade"))
    .addColumn("workspace_uuid", "uuid", (c) => c.notNull().references("workspaces.uuid").onDelete("cascade"))
    .addColumn("version", "integer", (c) => c.notNull())
    .addColumn("kind", "text", (c) => c.notNull()) // 'mirror' | 'template'
    .addColumn("deploy_prefix", "text", (c) => c.notNull())
    .addColumn("label", "text")
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn("published_at", "timestamptz")
    .execute();
  await sql`CREATE UNIQUE INDEX site_versions_site_version_idx ON site_versions (site_uuid, version)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("site_versions").execute();
}
```

Hand-add to `src/types/db.ts` (match codegen style):
```typescript
export interface SiteVersions {
  uuid: Generated<string>;
  siteUuid: string;
  workspaceUuid: string;
  version: number;
  kind: string;
  deployPrefix: string;
  label: string | null;
  createdAt: Generated<Timestamp>;
  publishedAt: Timestamp | null;
}
// DB interface (alphabetical): siteVersions: SiteVersions;
```
Add `"site_versions"` to the truncate list in `test/setup.ts` (before `"sites"`).

Run from `apps/api/`: `pnpm migrate:test latest` — Expected: executes clean.

- [ ] **Step 2: Failing tests** — `test/site-versions.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../src/database";
import { setupTestContext } from "./setup";
import { recordSiteVersion, publishSiteVersion, listSiteVersions } from "../src/services/site-versions";

function mockS3() {
  // publishSiteVersion delegates S3 work to promoteDeploy — a no-op-ish mock suffices here.
  return { send: vi.fn(async () => ({ Contents: [], IsTruncated: false })) } as any;
}

describe("site versions", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ctx = await setupTestContext();
    workspaceUuid = ctx.workspace.uuid;
    const site = await db.insertInto("sites")
      .values({ workspaceUuid, name: "G", slug: "g" })
      .returning("uuid").executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  it("records sequential versions starting at 1", async () => {
    const v1 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "mirror", deployPrefix: "sites/x/deploys/a", label: "Initial mirror" });
    const v2 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "template", deployPrefix: "sites/x/deploys/b", label: "Template v1" });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  it("publish stamps published_at and promotes to current/", async () => {
    const v1 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "mirror", deployPrefix: "sites/x/deploys/a" });
    const s3 = mockS3();
    await publishSiteVersion(db, s3, "bucket", siteUuid, v1.version);
    const rows = await listSiteVersions(db, siteUuid);
    expect(rows[0].publishedAt).not.toBeNull();
    expect(s3.send).toHaveBeenCalled(); // promoteDeploy listed the prefix
  });

  it("rollback = publishing an older version again", async () => {
    const v1 = await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "mirror", deployPrefix: "sites/x/deploys/a" });
    await recordSiteVersion(db, { siteUuid, workspaceUuid, kind: "template", deployPrefix: "sites/x/deploys/b" });
    const s3 = mockS3();
    await publishSiteVersion(db, s3, "bucket", siteUuid, 2);
    await publishSiteVersion(db, s3, "bucket", siteUuid, v1.version); // rollback
    const rows = await listSiteVersions(db, siteUuid);
    const one = rows.find((r) => r.version === 1)!;
    const two = rows.find((r) => r.version === 2)!;
    expect(one.publishedAt!.getTime()).toBeGreaterThan(two.publishedAt!.getTime());
  });

  it("publishing an unknown version throws", async () => {
    await expect(publishSiteVersion(db, mockS3(), "bucket", siteUuid, 99)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run** — Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/services/site-versions.ts`**

```typescript
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DB } from "../types/db";
import { promoteDeploy } from "./mirror/deploy";

export interface RecordVersionInput {
  siteUuid: string;
  workspaceUuid: string;
  kind: "mirror" | "template";
  deployPrefix: string;
  label?: string;
}

export async function recordSiteVersion(db: Kysely<DB>, input: RecordVersionInput) {
  return db.insertInto("siteVersions")
    .values({
      siteUuid: input.siteUuid,
      workspaceUuid: input.workspaceUuid,
      // Atomic next-version (same pattern as transforms ordinal)
      version: sql<number>`(select coalesce(max(version), 0) + 1 from site_versions where site_uuid = ${input.siteUuid})`,
      kind: input.kind,
      deployPrefix: input.deployPrefix,
      label: input.label ?? null,
    })
    .returning(["uuid", "version", "deployPrefix"])
    .executeTakeFirstOrThrow();
}

export async function publishSiteVersion(
  db: Kysely<DB>,
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
  version: number,
): Promise<{ version: number; deployPrefix: string }> {
  const row = await db.selectFrom("siteVersions")
    .select(["uuid", "version", "deployPrefix"])
    .where("siteUuid", "=", siteUuid)
    .where("version", "=", version)
    .executeTakeFirst();
  if (!row) throw new Error(`Version ${version} not found for site ${siteUuid}`);

  // Repoint current/: copy version prefix in, delete orphans (promoteDeploy does both).
  await promoteDeploy(s3Client, bucket, siteUuid, row.deployPrefix);

  await db.updateTable("siteVersions")
    .set({ publishedAt: new Date() })
    .where("uuid", "=", row.uuid)
    .execute();

  return { version: row.version, deployPrefix: row.deployPrefix };
}

export async function listSiteVersions(db: Kysely<DB>, siteUuid: string) {
  return db.selectFrom("siteVersions")
    .selectAll()
    .where("siteUuid", "=", siteUuid)
    .orderBy("version", "desc")
    .execute();
}
```

- [ ] **Step 5: Run** — Expected: 4 passing.

- [ ] **Step 6: Routes `src/api/routes/versions.ts`** (workspace-authed; follow the `ownedSite` guard pattern from `src/api/routes/mirror.ts` exactly):

```typescript
import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { getS3Client } from "../../s3";
import { listSiteVersions, publishSiteVersion } from "../../services/site-versions";

const Params = z.object({ siteUuid: z.string().uuid() });
const PublishParams = Params.extend({ version: z.coerce.number().int().positive() });
const ErrorSchema = z.object({ error: z.string() });

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  async function ownedSite(siteUuid: string, workspaceUuid: string) {
    return fastify.db.selectFrom("sites").select("uuid")
      .where("uuid", "=", siteUuid).where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
  }

  fastify.get(
    "/sites/:siteUuid/versions",
    { schema: { params: Params, response: { 404: ErrorSchema } } },
    async (request, reply) => {
      const { siteUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) return reply.code(404).send({ error: "Site not found" });
      return listSiteVersions(fastify.db, siteUuid);
    },
  );

  fastify.post(
    "/sites/:siteUuid/versions/:version/publish",
    {
      schema: {
        params: PublishParams,
        response: { 200: z.object({ version: z.number(), deployPrefix: z.string() }), 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { siteUuid, version } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) return reply.code(404).send({ error: "Site not found" });
      const config = fastify.config;
      const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
      const s3Client = getS3Client({
        endpoint: config.S3_ENDPOINT, region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY,
      });
      try {
        return await publishSiteVersion(fastify.db, s3Client, bucket, siteUuid, version);
      } catch (err) {
        return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  done();
};

export default app;
```

If the response schema for the GET list fights the type checker, add an explicit `z.array(...)` row schema mirroring `SiteVersions` (same fix used in `routes/transforms.ts`).

- [ ] **Step 7: Mirror pipeline records version 1**

In `src/services/mirror/run-mirror.ts`, immediately after the `promoteDeploy(...)` call, add:
```typescript
    const { recordSiteVersion } = await import("../site-versions.js");
    const versionRow = await recordSiteVersion(db, {
      siteUuid, workspaceUuid, kind: "mirror",
      deployPrefix: deploy.deployPrefix, label: "Site capture",
    });
    await db.updateTable("siteVersions").set({ publishedAt: new Date() })
      .where("uuid", "=", versionRow.uuid).execute();
```
(promoteDeploy already ran, so stamping `publishedAt` directly is correct — don't call publishSiteVersion and re-copy.)

- [ ] **Step 8: Build + full API test run + commit**

Run from `apps/api/`: `npx tsc --noEmit && pnpm test test/site-versions.test.ts test/mirror/` — Expected: clean, all passing.
```bash
git add apps/api
git commit -m "feat(versions): site_versions table, publish/rollback service+routes, mirror records v1"
```

---

## Task 16: API — template deploy runner + 301 redirect map

**Files (all under `apps/api/`):**
- Create: `src/utils/template/redirects.ts`
- Test: `test/template-redirects.test.ts`
- Create: `src/services/template/deploy-template.ts`
- Create: `scripts/eval/run-template-deploy.ts`

- [ ] **Step 1: Failing tests for the redirect map** — `test/template-redirects.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeRedirects } from "../src/utils/template/redirects";

const NEW_ROUTES = ["/", "/about", "/pricing", "/contact", "/schedule", "/blog",
  "/blog/top-10-reasons-to-join-a-gym-in-overland-park", "/programs/crossfit-classes", "/local-guide"];

describe("computeRedirects", () => {
  it("skips old paths that still exist", () => {
    const r = computeRedirects(["/about", "/blog"], NEW_ROUTES);
    expect(r).toHaveLength(0);
  });

  it("maps renamed paths by matching last segment", () => {
    const r = computeRedirects(["/programs/crossfit"], NEW_ROUTES.concat("/programs/crossfit"));
    expect(r).toHaveLength(0); // exact exists → no redirect
    const r2 = computeRedirects(["/our-programs/crossfit-classes"], NEW_ROUTES);
    expect(r2).toEqual([{ from: "/our-programs/crossfit-classes", to: "/programs/crossfit-classes", reason: "slug-match" }]);
  });

  it("maps known family prefixes when no slug match exists", () => {
    const r = computeRedirects(["/membership-pricing-request"], NEW_ROUTES);
    expect(r[0].to).toBe("/pricing");
    const r2 = computeRedirects(["/blog/some-deleted-post"], NEW_ROUTES);
    expect(r2[0].to).toBe("/blog");
  });

  it("falls back to homepage for unmatchable orphans, flagged", () => {
    const r = computeRedirects(["/random-old-page"], NEW_ROUTES);
    expect(r).toEqual([{ from: "/random-old-page", to: "/", reason: "fallback" }]);
  });

  it("normalizes trailing slashes before comparing", () => {
    expect(computeRedirects(["/about/"], NEW_ROUTES)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run** — from `apps/api/`: `pnpm test test/template-redirects.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/utils/template/redirects.ts`**

```typescript
export interface Redirect { from: string; to: string; reason: "slug-match" | "family" | "fallback" }

const norm = (p: string) => (p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p);
const lastSegment = (p: string) => norm(p).split("/").filter(Boolean).pop() ?? "";

/** Family prefixes: old first-segment (or keyword) → new route, checked in order. */
const FAMILY_RULES: [RegExp, string][] = [
  [/pricing|membership/i, "/pricing"],
  [/^\/blog\//, "/blog"],
  [/^\/recipes(\/|$)/, "/blog"],
  [/^\/coaches(\/|$)/, "/about"],
  [/^\/contact/, "/contact"],
  [/schedule/i, "/schedule"],
  [/guide/i, "/local-guide"],
];

export function computeRedirects(oldPaths: string[], newRoutes: string[]): Redirect[] {
  const routes = new Set(newRoutes.map(norm));
  const bySlug = new Map<string, string>();
  for (const r of newRoutes) {
    const s = lastSegment(r);
    if (s) bySlug.set(s, norm(r)); // last write wins — fine, slugs are near-unique
  }

  const out: Redirect[] = [];
  for (const raw of oldPaths) {
    const p = norm(raw);
    if (routes.has(p)) continue;

    const slugTarget = bySlug.get(lastSegment(p));
    if (slugTarget && slugTarget !== p) {
      out.push({ from: p, to: slugTarget, reason: "slug-match" });
      continue;
    }

    const family = FAMILY_RULES.find(([re]) => re.test(p));
    if (family && routes.has(family[1])) {
      out.push({ from: p, to: family[1], reason: "family" });
      continue;
    }

    out.push({ from: p, to: "/", reason: "fallback" });
  }
  return out;
}
```

- [ ] **Step 4: Run** — Expected: 5 passing.

- [ ] **Step 5: Implement the deploy service `src/services/template/deploy-template.ts`**

```typescript
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import { loadArtifact } from "../../utils/pipeline/artifact-store";
import { buildRedirectHtml } from "../../utils/mirror/site-meta";
import { pathToFileKey } from "../mirror/snapshot";
import { computeRedirects } from "../../utils/template/redirects";
import { recordSiteVersion } from "../site-versions";
import type { MirrorCrawlArtifact } from "../../types/mirror";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
const mimeFor = (file: string) => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : Promise.resolve([full]);
  }));
  return files.flat();
}

/** dist file → route ("index.html" → "/", "about/index.html" → "/about") */
function fileToRoute(rel: string): string | null {
  if (!rel.endsWith("index.html")) return null;
  const p = "/" + rel.slice(0, -"index.html".length).replace(/\/$/, "");
  return p === "" ? "/" : p === "/" ? "/" : p.replace(/\/$/, "");
}

export interface DeployTemplateInput {
  db: Kysely<DB>;
  s3Client: S3Client;
  bucket: string;
  siteUuid: string;
  workspaceUuid: string;
  /** The validated GymSiteContent object to build with. */
  content: unknown;
  /** Absolute path to apps/renderer. */
  rendererDir: string;
  label?: string;
  log: { info: (o: object, m: string) => void };
}

export async function deployTemplate(input: DeployTemplateInput) {
  const { db, s3Client, bucket, siteUuid, workspaceUuid, content, rendererDir, log } = input;

  // 1. Inject content + build
  await fs.writeFile(path.join(rendererDir, "src/content/gym.json"), JSON.stringify(content, null, 2));
  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["build"], { cwd: rendererDir, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`astro build exited ${code}`))));
    child.on("error", reject);
  });

  // 2. Upload dist to an immutable prefix
  const deployPrefix = `sites/${siteUuid}/deploys/tpl-${Date.now()}`;
  const distDir = path.join(rendererDir, "dist");
  const files = await walk(distDir);
  for (const file of files) {
    const rel = path.relative(distDir, file).split(path.sep).join("/");
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket, Key: `${deployPrefix}/${rel}`,
      Body: await fs.readFile(file), ContentType: mimeFor(file),
    }));
  }
  log.info({ deployPrefix, fileCount: files.length }, "template dist uploaded");

  // 3. Redirect map: old mirror URLs that no longer exist → redirect pages
  const crawl = await loadArtifact<MirrorCrawlArtifact>(db, { siteUuid, workspaceUuid }, "mirror-crawl");
  const oldPaths = crawl?.payload.pages.map((p) => p.path) ?? [];
  const newRoutes = files
    .map((f) => fileToRoute(path.relative(distDir, f).split(path.sep).join("/")))
    .filter((r): r is string => r !== null);
  const redirects = computeRedirects(oldPaths, newRoutes);
  for (const r of redirects) {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket, Key: `${deployPrefix}/${pathToFileKey(r.from)}`,
      Body: Buffer.from(buildRedirectHtml(r.to), "utf8"),
      ContentType: "text/html; charset=utf-8",
    }));
  }
  log.info({ redirects: redirects.length }, "redirect pages written");

  // 4. Record the version (publish is a separate, explicit call)
  const version = await recordSiteVersion(db, {
    siteUuid, workspaceUuid, kind: "template", deployPrefix,
    label: input.label ?? "Template build",
  });

  return { version: version.version, deployPrefix, routes: newRoutes.length, redirects };
}
```

- [ ] **Step 6: CLI script `scripts/eval/run-template-deploy.ts`**

```typescript
/**
 * Build + deploy the Astro template for a site, record a version, optionally publish.
 *
 * Usage (from apps/api/):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/eval/run-template-deploy.ts \
 *     --site <siteUuid> --content ../renderer/src/content/gym.fixture.json [--publish]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db, config } from "../../src/database";
import { getS3Client } from "../../src/s3";
import { deployTemplate } from "../../src/services/template/deploy-template";
import { publishSiteVersion } from "../../src/services/site-versions";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && !process.argv[i + 1]?.startsWith("--") ? process.argv[i + 1] : undefined;
}

async function main() {
  const siteUuid = arg("site");
  const contentPath = arg("content");
  const publish = process.argv.includes("--publish");
  if (!siteUuid || !contentPath) {
    console.error("Usage: --site <uuid> --content <path-to-gym.json> [--publish]");
    process.exit(1);
  }

  const site = await db.selectFrom("sites").select(["uuid", "workspaceUuid"]).where("uuid", "=", siteUuid).executeTakeFirstOrThrow();
  const content = JSON.parse(readFileSync(contentPath, "utf8"));
  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  const s3Client = getS3Client({
    endpoint: config.S3_ENDPOINT, region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY,
  });
  const rendererDir = path.resolve(process.cwd(), "../renderer");

  const result = await deployTemplate({
    db, s3Client, bucket,
    siteUuid: site.uuid, workspaceUuid: site.workspaceUuid,
    content, rendererDir,
    log: { info: (o, m) => console.log(m, o) },
  });
  console.log(`Version ${result.version} @ ${result.deployPrefix} — ${result.routes} routes, ${result.redirects.length} redirects`);
  for (const r of result.redirects) console.log(`  301 ${r.from} → ${r.to} (${r.reason})`);

  if (publish) {
    await publishSiteVersion(db, s3Client, bucket, site.uuid, result.version);
    console.log(`Published version ${result.version} to current/`);
  }
  await db.destroy();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 7: Build + commit**

Run from `apps/api/`: `npx tsc --noEmit` — Expected: clean.
```bash
git add apps/api/src/utils/template apps/api/src/services/template apps/api/scripts/eval/run-template-deploy.ts apps/api/test/template-redirects.test.ts
git commit -m "feat(template): deploy runner — content-injected astro build, S3 upload, 301 redirect map, version record"
```

---

## Task 17: Template eval + GSC/IndexNow operator checklist

**Files:**
- Create: `apps/api/scripts/eval/run-template-eval.ts`
- Create: `docs/superpowers/plans/2026-07-05-gsc-indexnow-setup.md` (operator checklist)

- [ ] **Step 1: Eval script** — serves the built renderer dist locally, crawls every internal link with Playwright, validates JSON-LD parses on every page, checks geo titles + discovery files, writes a report, exits 1 on failure:

```typescript
/**
 * Template eval — build-quality gate for the Astro template.
 * Usage (from apps/api/): pnpm tsx scripts/eval/run-template-eval.ts [--dist ../renderer/dist]
 * Precondition: the renderer has been built (cd ../renderer && pnpm test builds it, or pnpm use:fixture && pnpm build).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".xml": "application/xml",
  ".txt": "text/plain", ".json": "application/json", ".webmanifest": "application/manifest+json",
};

function argOr(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

async function main() {
  const distDir = path.resolve(process.cwd(), argOr("dist", "../renderer/dist"));
  if (!existsSync(path.join(distDir, "index.html"))) {
    console.error(`No build at ${distDir} — run: cd ../renderer && pnpm use:fixture && pnpm build`);
    process.exit(1);
  }

  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    let file = path.join(distDir, url);
    if (url.endsWith("/")) file = path.join(file, "index.html");
    else if (!path.extname(file)) file = path.join(file, "index.html");
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const failures: string[] = [];
  const visited = new Set<string>();
  const queue = ["/"];
  const browser = await chromium.launch();
  const page = await browser.newPage();

  while (queue.length > 0) {
    const route = queue.shift()!;
    if (visited.has(route)) continue;
    visited.add(route);

    const res = await page.goto(base + route, { waitUntil: "domcontentloaded" });
    if (!res || res.status() >= 400) { failures.push(`${route}: HTTP ${res?.status()}`); continue; }

    // JSON-LD must parse on every page
    const ldErrors = await page.evaluate(() => {
      const errs: string[] = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s, i) => {
        try { JSON.parse(s.textContent ?? ""); } catch { errs.push(`ld+json #${i} invalid`); }
      });
      if (document.querySelectorAll('script[type="application/ld+json"]').length === 0) errs.push("no JSON-LD");
      return errs;
    });
    for (const e of ldErrors) failures.push(`${route}: ${e}`);

    // enqueue internal links
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
        .filter((h) => h.startsWith("/") && !h.startsWith("//")),
    );
    for (const l of links) { const clean = l.split("#")[0].split("?")[0]; if (clean && !visited.has(clean)) queue.push(clean); }
  }
  await browser.close();

  // Discovery files
  for (const f of ["sitemap.xml", "robots.txt", "llms.txt", "rss.xml"]) {
    if (!existsSync(path.join(distDir, f))) failures.push(`missing ${f}`);
  }

  server.close();
  const report = [
    `# Template eval — ${new Date().toISOString()}`,
    `Pages crawled: ${visited.size}`,
    failures.length === 0 ? "✅ ALL PASS" : `❌ ${failures.length} failures:`,
    ...failures.map((f) => `- ${f}`),
  ].join("\n");
  const reportPath = path.join(process.cwd(), "scripts/eval", `eval-report-template-${Date.now()}.md`);
  writeFileSync(reportPath, report);
  console.log(report);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Manual Lighthouse: cd ../renderer && pnpm preview, then: npx lighthouse http://localhost:4321 --view (target ≥95 all categories)`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run it**

From `apps/renderer/`: `pnpm use:fixture && pnpm build`
From `apps/api/`: `pnpm tsx scripts/eval/run-template-eval.ts`
Expected: crawls every page reachable from `/`, `✅ ALL PASS`, exit 0. Fix any failures before committing (a failure here is a template bug).

- [ ] **Step 3: GSC/IndexNow operator checklist** — `docs/superpowers/plans/2026-07-05-gsc-indexnow-setup.md`:

```markdown
# GSC + IndexNow — operator setup (once) and go-live hooks (Phase 2b code)

## One-time (Google Cloud console)
1. Create project `pushpress-sites-seo` (or reuse existing).
2. Enable "Google Search Console API".
3. Create a service account `gsc-automation@...iam.gserviceaccount.com`; download JSON key.
4. Store key in secrets as GSC_SERVICE_ACCOUNT_JSON.

## Per-site at go-live (to be automated in the cutover flow, Phase 2b)
1. Site verification: template already serves the `google-site-verification` meta tag
   (set `meta.googleSiteVerification` in content). Alternative once we control DNS: TXT record.
2. Create property: `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}` (service account).
3. Submit sitemap: `PUT .../sites/{siteUrl}/sitemaps/{siteUrl}/sitemap.xml`.
4. IndexNow: generate a key per site, host at `/{key}.txt` (add to template deploy),
   then `GET https://api.indexnow.org/indexnow?url={siteUrl}&key={key}` on every publish.

## Later (Phase 2b/c — the data moat)
- Search Analytics ingestion: `searchanalytics.query` per site daily → keyword/impression/position store
  → feeds the AI content loop (content wells targeting rising queries).
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/scripts/eval/run-template-eval.ts
git add -f docs/superpowers/plans/2026-07-05-gsc-indexnow-setup.md
git commit -m "feat(template): eval — full-site crawl, JSON-LD validation, discovery files; GSC/IndexNow operator checklist"
```

---

## Completion checklist (map back to spec Revision 2)

- [ ] One opinionated template, brand-token themed, all pages (Tasks 3–13)
- [ ] 14 section components incl. FeatureGrid, PricingGrid, StickyCTA, RichContent (Tasks 6–11)
- [ ] SEO: LocalBusiness+SportsActivityLocation (+rating, sameAs, NAP), Breadcrumb, Service, FAQPage, BlogPosting, geo titles, OG/Twitter, canonical, verification (Tasks 4, 7, 9, 12)
- [ ] Tracking: GTM-first injection, GA/Pixel fallback, UTM session capture → hidden fields, standard events (Task 5)
- [ ] Content wells: /local-guide + blog categories + RSS (Task 12)
- [ ] Discovery: sitemap (preview-aware), robots, llms.txt, webmanifest (Task 13)
- [ ] Forms contract: LeadForm → POST /api/forms/{siteId}/{formId} → leads table with UTM (Tasks 10, 14)
- [ ] Versioning: site_versions, mirror = v1, publish/rollback routes (Task 15)
- [ ] Whole-site swap deploy with 301 redirect map from mirror crawl (Task 16)
- [ ] Eval: full crawl + JSON-LD validation + discovery files; Lighthouse manual target ≥95 (Task 17)
- [ ] Deferred to 2b: content mapper (docs→gym.json), LLM gap fill, GSC automation code, IndexNow key hosting, upgrade HTTP route/queue, Astro <Image> once assets are S3-local




