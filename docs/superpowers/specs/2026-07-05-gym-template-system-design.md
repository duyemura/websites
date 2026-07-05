# Gym Template System — Design Spec

**Date:** 2026-07-05  
**Status:** Approved  
**Reference site:** https://www.ksathleticclub.com/

## Context

Phase 2 of the site platform. Gyms start on the Hosted tier (static mirror). The Managed tier upgrade replaces mirror pages one at a time with Astro-rendered pages that we own and control — built-in SEO schema, brand token theming, and AI content management. The `page-replace` transform mechanism from Phase 1 is the deploy hook.

The renderer app (`apps/renderer`) already exists as an empty Astro + Tailwind + React static output project.

---

## Page Types

Six page types cover every gym website pattern. The schedule page is deliberately excluded — it always embeds a PushPress booking widget and stays as a mirror page.

| Page | URL pattern | Notes |
|------|-------------|-------|
| Homepage | `/` | Primary landing, all above-the-fold conversion |
| Program page | `/programs/:slug` | Reusable for CrossFit, Bootcamp, PT, Nutrition, etc. |
| About page | `/about` | Gym story + team grid |
| Pricing page | `/pricing` | Lead capture form (pricing on request) |
| Contact page | `/contact` | Contact form + address |
| Blog index | `/blog` | Post list |
| Blog post | `/blog/:slug` | Article content |

---

## Section Components

Fourteen section types cover all content patterns observed across gym sites. Every page is composed from a subset of these. `RichContent` is the escape hatch for content that doesn't fit a named type.

| Component | Used on | Description |
|-----------|---------|-------------|
| `Hero` | All pages | Headline, subheading, CTA button, background image |
| `ValueProps` | Home, Program, About | 3–6 item icon + headline + short body grid. Used for both value props AND the "Why People Choose Us" community card set (4 items). |
| `FeatureGrid` | Home | Icon + single label grid (6 items, 2–3 col). Used for "Everything You Need To Crush Your Fitness Goals" — no body copy, higher item density than ValueProps. |
| `ProgramCards` | Home | Cards with image, name, description, link. Optional promo badge ("Try 28 Days for $28"). |
| `HowItWorks` | Home, Program | Numbered step-by-step process |
| `TeamGrid` | About | Coach cards: photo, name, title, short bio |
| `Testimonials` | Home, Program | Quote cards with member name/photo |
| `FAQ` | Home, Program | Accordion — supports 24+ items. Used on homepage and program pages. |
| `CTABand` | All pages | Full-width headline + optional CTA button. Button is optional so this doubles as the trust band ("Trusted and Loved By Hundreds of Overland Park Residents") when used without a button. |
| `Location` | Home, Contact | Address, hours, directions link, optional map embed |
| `PricingForm` | Pricing | Lead capture form (name, email, phone → lead) |
| `BlogList` | Blog index | Single-column post cards: cover image, category label, title, excerpt, link. Pagination controls at bottom. |
| `BlogPost` | Blog post | Markdown body + cover image, author, date, category, tags |
| `RichContent` | Any page | Generic flexible section — typed block union (see below) |

---

## Content Schema

A TypeScript schema defined in `apps/renderer/src/types/gym-content.ts` is the contract between the content mapper (API side) and the template (renderer side). Content is injected as `src/content/gym.json` at build time — no runtime API calls.

```typescript
// Top-level shape
interface GymSiteContent {
  meta: SiteMeta        // site-wide SEO, analytics IDs
  business: BusinessInfo // name, address, phone, hours, coordinates
  brand: BrandTokens    // colors, fonts, logo URL
  pages: PageContent    // all page-specific content
}

interface SiteMeta {
  siteUrl: string          // canonical domain (e.g. https://gym.com)
  defaultTitle: string     // fallback page title
  defaultDescription: string
  googleAnalyticsId?: string
  facebookPixelId?: string
}

interface BusinessInfo {
  name: string
  tagline: string
  address: { street: string; city: string; state: string; zip: string }
  phone: string
  email?: string
  hours: { day: string; open: string; close: string }[]
  coordinates?: { lat: number; lng: number }
  primaryCta: { label: string; url: string }  // e.g. "Free Discovery Call"
  trialCta?: { label: string; url: string }   // e.g. "Try 28 Days for $28"
  // Geo fields for SEO-targeted headlines e.g. "CrossFit Classes in Overland Park, KS"
  geo: { city: string; state: string; stateAbbr: string }
  // Service area communities for location section copy
  serviceArea?: string[]  // e.g. ["Leawood", "Olathe", "Lenexa"]
}

interface BrandTokens {
  primaryColor: string      // hex
  secondaryColor: string
  accentColor: string
  headingFont: string       // Google Fonts name or system font
  bodyFont: string
  logoUrl: string
  logoAlt: string
}

interface PageContent {
  home: HomeContent
  programs: ProgramContent[]
  about: AboutContent
  pricing: PricingContent
  contact: ContactContent
  blog: BlogContent
}

// --- Page-specific content ---

interface HomeContent {
  hero: HeroContent
  valueProps: ValueProp[]            // 3-col "A Welcoming Gym", "Beginner Friendly", "Accountability"
  programsHeadline: string           // "EVERY BODY IS UNIQUE. Find a Fitness Routine..."
  featuredPrograms: string[]         // slugs from programs[]
  features: Feature[]                // 6-item FeatureGrid: "Nutrition Programming", "Members App", etc.
  communityProps: ValueProp[]        // 4-col "Expert Coaching", "Beginner Friendly", etc.
  trustHeadline: string              // "Trusted and Loved By Hundreds of Overland Park Residents"
  howItWorks: Step[]
  testimonials: Testimonial[]
  faq: FAQItem[]
  richContent?: RichContentSection[]
}

interface ProgramContent {
  slug: string              // e.g. "crossfit-classes"
  name: string              // e.g. "CrossFit Classes"
  shortDescription: string  // used on program cards
  coverImageUrl: string     // used on program cards and hero
  // Geo-targeted headline e.g. "CrossFit Classes in Overland Park, KS"
  // Template auto-builds from name + business.geo if not provided
  geoHeadline?: string
  hero: HeroContent
  whatIsIt: { headline: string; body: string }
  whatMakesUsDifferent: string[]  // 4-5 bullet points
  whatToExpect: string            // class structure description
  whoIsItFor: string[]
  gettingStarted: Step[]
  testimonials: Testimonial[]
  faq: FAQItem[]
  richContent?: RichContentSection[]
}

interface AboutContent {
  hero: HeroContent
  gymStory: string
  team: TeamMember[]
}

interface PricingContent {
  hero: HeroContent
  intro: string   // "Fill out the form below to receive our pricing"
}

interface ContactContent {
  hero: HeroContent
  intro?: string
}

interface BlogContent {
  posts: BlogPost[]
}

// --- Shared types ---

interface HeroContent {
  headline: string
  subheading?: string
  ctaLabel: string
  ctaUrl: string
  backgroundImageUrl: string
}

interface ValueProp {
  icon: string    // emoji or icon name
  headline: string
  body: string
}

// Used by FeatureGrid — higher-density, no body copy (6+ items)
interface Feature {
  icon: string
  label: string
}

interface Step {
  number: number
  headline: string
  body: string
}

interface Testimonial {
  quote: string
  name: string
  photoUrl?: string
  program?: string
}

interface FAQItem {
  question: string
  answer: string
}

interface TeamMember {
  name: string
  title: string
  photoUrl: string
  bio?: string
}

interface BlogPost {
  slug: string
  title: string
  publishedAt: string       // ISO date
  excerpt: string
  category?: string         // e.g. "Education", "Newsletters"
  body: string              // Markdown — Astro renders natively via @astrojs/markdown-remark.
                            // LLMs write clean markdown naturally. Images use standard
                            // ![alt](url) syntax with URLs rehosted to S3.
  coverImageUrl?: string
  author?: string
  tags?: string[]
  keyBlocks?: ContentBlock[] // Optional featured callouts shown above the markdown body
}

// --- Generic content block (the flexible escape hatch) ---
// Used by RichContent section for anything that doesn't fit a named section type:
// narrative paragraphs, video embeds, award grids, announcements, partnerships.

type ContentBlock =
  | { type: "text";    html: string }
  | { type: "image";   url: string; alt: string; caption?: string }
  | { type: "video";   url: string; poster?: string }
  | { type: "columns"; columns: ContentBlock[][] }
  | { type: "callout"; text: string; style: "info" | "warning" | "tip" }
  | { type: "embed";   html: string }  // third-party widgets, maps, iframes

interface RichContentSection {
  headline?: string
  blocks: ContentBlock[]
}

// Any page can have richContent?: RichContentSection[] between its named sections.
```

---

## Built-in SEO (Managed tier differentiator)

Every page automatically gets structured data the frozen mirror never had:

**`LocalBusiness` JSON-LD** (all pages, from `business` data):
```json
{
  "@type": "LocalBusiness",
  "name": "KS Athletic Club",
  "address": { "@type": "PostalAddress", ... },
  "telephone": "(913) 320-0043",
  "openingHoursSpecification": [...],
  "geo": { "@type": "GeoCoordinates", "latitude": 38.9, "longitude": -94.7 }
}
```

**`SportsActivityLocation`** for gym-specific rich results.

**`FAQPage` JSON-LD** — injected on pages that have FAQ sections.

**Per-page meta**: auto-generated `<title>`, `<meta description>`, Open Graph, canonical URL.

---

## File Structure

```
apps/renderer/
  src/
    layouts/
      GymLayout.astro        # Nav, footer, SEO schema injection
    pages/
      index.astro            # Homepage
      programs/
        [slug].astro         # Dynamic program pages
      about.astro
      pricing.astro
      contact.astro
      blog/
        index.astro
        [slug].astro
    components/
      sections/
        Hero.astro
        ValueProps.astro       # 3-6 items, icon + headline + body
        FeatureGrid.astro      # 6+ items, icon + label only (higher density)
        ProgramCards.astro     # optional promoBadge prop
        HowItWorks.astro
        TeamGrid.astro
        Testimonials.astro
        FAQ.astro
        CTABand.astro
        Location.astro
        PricingForm.astro    # React component (form state)
        BlogList.astro
        BlogPost.astro       # Renders markdown body via Astro Content Collections
        RichContent.astro    # Iterates ContentBlock[] and renders sub-types
      blocks/               # Sub-components used by RichContent
        TextBlock.astro
        ImageBlock.astro
        VideoBlock.astro
        ColumnsBlock.astro
        CalloutBlock.astro
        EmbedBlock.astro
      ui/
        Button.astro
        Card.astro
        Container.astro
        SectionHeading.astro
      seo/
        LocalBusinessSchema.astro
        FAQSchema.astro
        OpenGraph.astro
    content/
      gym.json               # Injected at build time — NOT committed
    types/
      gym-content.ts         # The schema above
  astro.config.mjs           # Already exists — add output: 'static'
  tailwind.config.mjs        # Already exists — extend with brand tokens
```

---

## Build Flow

```
1. POST /api/sites/:uuid/upgrade/page { path: "/" }
   ↓
2. Content mapper: reads docs table → serializes to GymSiteContent JSON
   (business-info + brand-guidelines + site-hierarchy sections)
   LLM fills any missing fields (missing testimonials, coach bios, etc.)
   ↓
3. Write JSON to apps/renderer/src/content/gym.json
   ↓
4. Run: cd apps/renderer && astro build
   ↓
5. dist/ output uploaded to S3: sites/{uuid}/artifacts/template/{timestamp}/
   ↓
6. page-replace transform created pointing at the uploaded artifact
   ↓
7. Next deploy picks up the transform — CloudFront serves Astro page
```

The `gym.json` file is never committed (gitignored). It's generated fresh per build. The same renderer build covers all pages — the JSON contains all pages' content.

---

## Content Mapper (Phase 2a — no LLM)

Initial implementation maps deterministically from docs:

| JSON field | Source |
|-----------|--------|
| `business.name` | `business-info.businessName` |
| `business.address` | `business-info.address` |
| `business.phone` | `business-info.phone` |
| `business.hours` | `business-info.hours` |
| `brand.primaryColor` | `design-system-v2.tokens['--color-primary']` |
| `brand.logoUrl` | `brand-guidelines.logo.url` |
| `pages.home.hero.headline` | `site-hierarchy.pages["/"].sections[hero].headingText` |
| `pages.home.faq` | `site-hierarchy.pages["/"].sections[faq].items` |
| `pages.about.team` | `site-hierarchy.pages["/about"].sections[team].members` |
| `pages.programs[*]` | One per `site-hierarchy.pages["/programs/*"]` |

Fields that don't map → left as empty string → LLM fills in Phase 2b.

---

## Styling

Tailwind with CSS custom properties driven by `brand` tokens:

```js
// tailwind.config.mjs
theme: {
  extend: {
    colors: {
      primary: 'var(--color-primary)',
      secondary: 'var(--color-secondary)',
      accent: 'var(--color-accent)',
    },
    fontFamily: {
      heading: 'var(--font-heading)',
      body: 'var(--font-body)',
    }
  }
}
```

`GymLayout.astro` injects brand tokens as CSS custom properties from `gym.json`. Every component uses `text-primary`, `bg-primary` etc. — the whole site rebrands by changing the JSON.

---

## What's Out of Scope (Phase 2a)

- LLM gap filling (Phase 2b)
- AI content monitoring / keyword tracking (Phase 2c)  
- Blog editor / CMS UI (separate workstream)
- Multi-location support
- Dark mode
- The upgrade API endpoint in apps/api (Phase 2b — Phase 2a just runs the build manually)
