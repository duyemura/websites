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
| `PricingGrid` | Pricing | Plan cards: name, price, features, CTA. Optional highlighted plan. Both grid and form can appear on same page. |
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
  siteUrl: string               // canonical domain (e.g. https://gym.com)
  defaultTitle: string          // fallback page title pattern e.g. "{page} | KS Athletic Club"
  defaultDescription: string    // fallback meta description

  // --- Verification ---
  googleSiteVerification?: string  // Google Search Console verification token
  bingVerification?: string        // Bing Webmaster Tools (optional)

  // --- Analytics & tracking ---
  // Prefer GTM — manages GA, Pixel, and any future tags from one container
  // without a redeploy. Marketing team can add/change tags independently.
  googleTagManagerId?: string   // GTM-XXXXXXX — preferred
  googleAnalyticsId?: string    // G-XXXXXXXXXX — fallback if no GTM
  facebookPixelId?: string      // Meta Pixel — fallback if no GTM
  tiktokPixelId?: string        // TikTok Pixel — fallback if no GTM
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
  // Geo — drives SEO titles ("CrossFit in Overland Park, KS") and LocalBusiness schema
  geo: { city: string; state: string; stateAbbr: string }
  // Service area for location section copy and areaServed schema
  serviceArea?: string[]  // e.g. ["Leawood", "Olathe", "Lenexa"]
  // Aggregate rating — shown in LocalBusiness schema (improves star snippet in SERP)
  aggregateRating?: {
    ratingValue: string    // e.g. "4.9"
    reviewCount: number    // e.g. 127
    bestRating?: string    // default "5"
  }
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
  // Gyms choose one or both patterns:
  grid?: PricingGridContent   // visible plan cards (transparency play)
  form?: {                    // pricing-on-request lead capture
    headline: string
    intro: string             // "Fill out the form below to receive our pricing..."
  }
}

interface PricingGridContent {
  headline?: string
  subheading?: string
  plans: PricingPlan[]
}

interface PricingPlan {
  name: string             // "Drop-in", "Monthly", "Annual"
  price: string            // "$149" or "Contact us"
  period?: string          // "/month", "/class", "/year"
  description?: string     // one-liner below the price
  features: string[]       // bullet points
  cta: { label: string; url: string }
  highlighted?: boolean    // renders with accent color + shadow ("most popular")
  badge?: string           // "Most Popular", "Best Value"
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

## Native Tracking (Managed tier)

Every template ships with GA4, Meta Pixel, TikTok Pixel, and UTM tracking built in. The gym never touches a script tag.

### Tag injection strategy

**Preferred: GTM container** — if `googleTagManagerId` is set, inject the GTM snippet in `<head>` and `<noscript>` only. GA4, Pixel, and any future tags are managed inside GTM without a redeploy. Marketing team controls all tags.

**Fallback: direct injection** — if individual IDs are set without GTM, inject each script directly. Simpler but requires a redeploy to add/change tags.

`GymLayout.astro` handles both cases:
```astro
{meta.googleTagManagerId ? (
  <GTMHead id={meta.googleTagManagerId} />
) : (
  <>
    {meta.googleAnalyticsId && <GAScript id={meta.googleAnalyticsId} />}
    {meta.facebookPixelId && <MetaPixelScript id={meta.facebookPixelId} />}
    {meta.tiktokPixelId && <TikTokPixelScript id={meta.tiktokPixelId} />}
  </>
)}
```

### Standard events (fired natively, no configuration)

| Event | Trigger | GA4 | Meta Pixel |
|-------|---------|-----|------------|
| Page view | Every page load | `page_view` | `PageView` |
| Lead | Any form submit | `generate_lead` | `Lead` |
| Contact | "Free Discovery Call" click | `contact` | `Contact` |
| Trial start | Trial CTA click | `begin_checkout` | `InitiateCheckout` |
| Schedule | Schedule page view | `schedule` | `Schedule` |

Events are fired by `TrackingEvents.ts` (a small vanilla JS module, no framework dependency) that runs on every page via a `<script>` tag in `GymLayout.astro`.

### UTM parameter tracking

UTMs are captured on every page load and persisted for the session. When any form submits, the stored UTM values are injected as hidden fields and passed to the lead.

**Flow:**
1. Visitor arrives at `gym.com/?utm_source=facebook&utm_medium=cpc&utm_campaign=spring-2026`
2. `UTMTracker.ts` reads params → stores in `sessionStorage` as `{ utm_source, utm_medium, utm_campaign, utm_content, utm_term }`
3. Visitor browses several pages (UTMs persist in session)
4. Visitor submits contact/pricing form
5. Hidden inputs with UTM values are included in the POST
6. Lead stored in DB includes `{ fields: { name, email, phone, utm_source: "facebook", ... } }`

**UTM fields stored:**
- `utm_source` — traffic source (facebook, google, email)
- `utm_medium` — channel (cpc, organic, social)
- `utm_campaign` — campaign name
- `utm_content` — ad variant
- `utm_term` — keyword

This gives the gym full attribution: they know which ad → which campaign → which lead → which conversion.

---

## Built-in SEO (Managed tier differentiator)

Every page automatically gets structured data, geo-targeted titles, and Open Graph tags the frozen mirror never had. Zero configuration by the gym owner.

---

### JSON-LD structured data

**`LocalBusiness` + `SportsActivityLocation`** — injected on every page via `GymLayout.astro`:
```json
{
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "SportsActivityLocation"],
  "name": "KS Athletic Club",
  "url": "https://ksathleticclub.com",
  "telephone": "(913) 320-0043",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "14875 Metcalf Ave",
    "addressLocality": "Overland Park",
    "addressRegion": "KS",
    "postalCode": "66223",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 38.9071,
    "longitude": -94.6752
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday"],
      "opens": "05:00",
      "closes": "21:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Saturday","Sunday"],
      "opens": "07:00",
      "closes": "12:00"
    }
  ],
  "areaServed": ["Overland Park", "Leawood", "Olathe", "Lenexa"],
  "aggregateRating": {
    "@type": "AggregateRating",
    "ratingValue": "4.9",
    "reviewCount": "127",
    "bestRating": "5"
  }
}
```

**`BreadcrumbList`** — every page except homepage:
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://ksathleticclub.com" },
    { "@type": "ListItem", "position": 2, "name": "CrossFit Classes", "item": "https://ksathleticclub.com/programs/crossfit-classes" }
  ]
}
```

**`Service`** — injected on every program page:
```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "CrossFit Classes",
  "serviceType": "CrossFit Training",
  "provider": { "@type": "LocalBusiness", "name": "KS Athletic Club" },
  "areaServed": [
    { "@type": "City", "name": "Overland Park" },
    { "@type": "City", "name": "Leawood" }
  ],
  "url": "https://ksathleticclub.com/programs/crossfit-classes"
}
```

**`FAQPage`** — injected on any page that renders a `FAQ` section:
```json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is CrossFit good for beginners?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. All workouts are coach-led and scalable." }
    }
  ]
}
```

**`BlogPosting`** — injected on every blog post page:
```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "Post Title",
  "datePublished": "2026-06-01",
  "author": { "@type": "Person", "name": "Coach Name" },
  "publisher": { "@type": "Organization", "name": "KS Athletic Club" },
  "url": "https://ksathleticclub.com/blog/post-slug",
  "image": "https://ksathleticclub.com/cover.jpg"
}
```

---

### Geo-targeted page titles and meta descriptions

Auto-generated from content schema — the gym never writes title tags.

| Page | `<title>` pattern |
|------|-------------------|
| Homepage | `CrossFit, Bootcamp & Personal Training in {City}, {State} \| {GymName}` |
| Program | `{ProgramName} in {City}, {State} \| {GymName}` |
| About | `About {GymName} \| Gym in {City}, {State}` |
| Pricing | `Membership Pricing \| {GymName} in {City}, {State}` |
| Contact | `Contact {GymName} \| Gym in {City}, {State}` |
| Blog index | `Fitness Tips & News \| {GymName} Blog` |
| Blog post | `{PostTitle} \| {GymName}` |

Meta descriptions follow the same geo-targeting pattern and are generated from the page's `hero.subheading` or a template string if no subheading exists.

---

### Open Graph + Twitter Card

Injected on every page via `OpenGraph.astro`:

```html
<!-- Open Graph -->
<meta property="og:type"        content="website" />
<meta property="og:title"       content="{page title}" />
<meta property="og:description" content="{meta description}" />
<meta property="og:url"         content="{canonical url}" />
<meta property="og:image"       content="{hero background or cover image}" />
<meta property="og:site_name"   content="{GymName}" />

<!-- Twitter Card -->
<meta name="twitter:card"        content="summary_large_image" />
<meta name="twitter:title"       content="{page title}" />
<meta name="twitter:description" content="{meta description}" />
<meta name="twitter:image"       content="{hero background or cover image}" />
```

---

### Canonical URL + robots

```html
<link rel="canonical" href="{siteUrl}{pagePath}" />
<!-- noindex on preview deploys, index on production — controlled by deploy flag in gym.json -->
<meta name="robots" content="{preview ? 'noindex,nofollow' : 'index,follow'}" />
```

---

### Google Search Console + Bing verification

```html
{meta.googleSiteVerification && (
  <meta name="google-site-verification" content="{meta.googleSiteVerification}" />
)}
{meta.bingVerification && (
  <meta name="msvalidate.01" content="{meta.bingVerification}" />
)}
```

---

### Sitemap.xml and robots.txt

Generated at build time from the page list (same logic as the mirror pipeline's `generateSitemap` / `generateRobots` utilities, reused here):

- `sitemap.xml` — all public pages with canonical URLs
- `robots.txt` — `Allow: /` + `Sitemap:` pointer (noindex pages suppressed from sitemap)

---

### Future: geo landing pages (Phase 2c)

Auto-generated `/near/{city}` pages for service area cities using the AI content pipeline. Not in Phase 2a scope but the schema (`serviceArea[]`) and geo fields are designed to support it.

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
        PricingGrid.astro    # Plan cards — grid or stacked
        PricingForm.astro   # React component (form state + UTM hidden fields)
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
        LocalBusinessSchema.astro  # LocalBusiness + SportsActivityLocation JSON-LD
        BreadcrumbSchema.astro     # BreadcrumbList JSON-LD
        ServiceSchema.astro        # Service JSON-LD (program pages)
        FAQSchema.astro            # FAQPage JSON-LD
        BlogPostingSchema.astro    # BlogPosting JSON-LD (blog posts)
        OpenGraph.astro            # og: + twitter: meta tags
        CanonicalMeta.astro        # canonical URL + robots + verification tags
      tracking/
        GTMHead.astro         # GTM container snippet
        GAScript.astro        # Direct GA4 fallback
        MetaPixelScript.astro # Direct Meta Pixel fallback
        TikTokPixelScript.astro
    scripts/
      UTMTracker.ts           # Captures + persists UTM params, injects into forms
      TrackingEvents.ts       # Fires GA4 + Pixel events on CTA clicks + form submits
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
