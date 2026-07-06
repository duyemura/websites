# Site Audit & Opportunity Scanner — Concept

**Status:** Documented, not yet built
**Date:** 2026-07-05

## The idea

After a gym's site is mirrored (free tier), automatically run a comprehensive audit and surface it as a persistent "what you're leaving on the table" report. Every issue includes an upgrade CTA. The report lives forever on the site and can be shared with the gym owner.

## Why it matters

Gyms want three things: be discovered, get people through the site, capture leads. This report frames every gap in those terms — not technical jargon. It's the upgrade pitch built into the product.

## Trigger & storage

- Runs automatically at end of `run-mirror.ts` (non-fatal)
- Stored as pipeline artifact `"site-audit"` via `saveArtifact`
- Re-runnable via `POST /sites/:uuid/audit/refresh` (no re-crawl, uses existing artifacts)
- Shareable link via `site_audit_shares` table (token-based, 30-day expiry)

## Categories

### 1. Technical SEO (Lighthouse)
Run Lighthouse (already in deps: `lighthouse@13`) against the live mirrored URL.
- Performance score, LCP, CLS, FCP
- Mobile-friendliness
- Accessibility

### 2. On-page SEO (search-presence doc)
- Title tags: unique, descriptive, include business name
- Meta descriptions: unique, not generic, ≤160 chars
- H1 presence and quality
- Image alt text
- Internal linking structure

### 3. Local SEO (search-presence + site-hierarchy)
- LocalBusiness schema present
- Address/phone/hours in schema
- City name in homepage title
- Service area pages missing (cross-ref `serviceArea[]` vs. pages)
- Google Maps embed / `geo` coordinates

### 4. Keyword opportunities (generated — no external API)
Use programs + city + serviceArea to compute keywords the site should be targeting:
```
"[program] [city]" → "CrossFit Overland Park"
"gym near [service area city]" → "gym near Leawood KS"
"[program] for beginners [city]"
"best gym in [city]"
"[program] classes [city] [stateAbbr]"
```
Cross-reference against search-presence doc titles/descriptions/H1s. Output: "X keywords people search in your area that your site doesn't appear for."

### 5. AI Search (AEO) (search-presence + crawl)
- llms.txt present and populated
- FAQ schema on program pages
- Speakable schema
- Structured entity description quality
- AI-readable content (is there a clear "who, what, where, how much")

### 6. Lead conversion (crawl + site-hierarchy)
- Form detected on homepage
- CTA above the fold
- Phone as `tel:` link
- Testimonials present
- Pricing visible
- Contact page exists
- Forms submit somewhere useful (not dead-end external CRM with no backup)
- Lead notification email configured

## Presentation

Each issue framed as an outcome, not a technical problem:
- **Outcome:** "You're invisible in local Google searches"  
- **Detail:** plain-language explanation  
- **Upgrade message:** "The Managed template adds LocalBusiness schema automatically"

Passed checks are hidden. Show progress: "2 of 5 local SEO issues addressed."

## Upgrade integration

- Report includes `upgradeAvailable: true`
- CTA triggers existing `POST /sites/:uuid/redeploy-template`
- Operator can also share a public link with the gym owner

## Future phases (needs external APIs)
- Actual keyword search volumes (Ahrefs/Semrush)
- Current ranking positions
- Competitor gap analysis
- Google Search Console integration (GSC plan already exists)

## Implementation complexity

Medium-large. Three phases make sense:
1. **Phase 1:** Deterministic checks from existing artifacts (~15 checks, 3 categories)
2. **Phase 2:** Lighthouse integration + keyword opportunity generator
3. **Phase 3:** External APIs for search volume data
