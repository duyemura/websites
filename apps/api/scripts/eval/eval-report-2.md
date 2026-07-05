# Scraper Eval Report 2 — pass-3 → pass-5

**Date:** 2026-07-03  
**URL file:** `/Users/dan/pushpress/websites/eval-gym-urls.txt` (40 sites)  
**Runs:** `scripts/eval/runs/pass-3/`, `scripts/eval/runs/pass-4/`, `scripts/eval/runs/pass-5/`  
**Tests:** 255/255 passing after all code changes

---

## 1. URL List — 40 Sites

### Carried over from previous eval (13 keepers)

| URL | Type | Geography |
|---|---|---|
| torrancetraininglab.com | CrossFit / PT | Torrance, CA |
| ksathleticclub.com | CrossFit / PT | KS (Midwest) |
| crossfitinvictus.com | CrossFit | San Diego, CA |
| crossfitmayhem.com | CrossFit | Cookeville, TN |
| crossfitsouthbrooklyn.com | CrossFit | Brooklyn, NY |
| f45training.com | HIIT franchise | National |
| orangetheory.com | HIIT franchise | National |
| barrysbootcamp.com | HIIT boutique | National |
| solidcore.co | Pilates/strength | National |
| rumbleboxing.com | Boxing boutique | National |
| 10thplanetlasvegas.com | BJJ | Las Vegas, NV |
| graciebarra.com | BJJ chain | International |
| 10thplanetjj.com | BJJ | National |

### New URLs (27 added)

| URL | Type | Geography |
|---|---|---|
| americantopteam.com | MMA | Coconut Creek, FL |
| jacksonwink.com | MMA | Albuquerque, NM |
| gleasonsgym.com | Boxing | Brooklyn, NY |
| wildcardboxing.com | Boxing | Hollywood, CA |
| corepoweryoga.com | Yoga | National |
| clubpilates.com | Pilates | National |
| californiastrength.com | Olympic Weightlifting | San Ramon, CA |
| crossfitaustin.com | CrossFit | Austin, TX |
| crossfitboston.com | CrossFit | Boston, MA |
| crossfitcentrallondon.co.uk | CrossFit | London, UK |
| crossfitsydney.com.au | CrossFit | Sydney, Australia |
| soul-cycle.com | Indoor Cycling | National |
| ufcgym.com | MMA / General Fitness | National |
| evolve-mma.com | MMA / Muay Thai | Singapore |
| crossfitce.com | CrossFit | Chicago, IL |
| mbfitmiamibeach.com | CrossFit / HIIT | Miami Beach, FL |
| crossfitnashville.com | CrossFit | Nashville, TN |
| tangletowncrossfit.com | CrossFit | Minneapolis, MN |
| startingstrengthgyms.com | Strength Training | National |
| crossfitbondi.com.au | CrossFit | Sydney, Australia |
| crossfitnorthlondon.co.uk | CrossFit | London, UK |
| crunch.com | General Fitness | National |
| anytimefitness.com | General Fitness 24hr | National |
| elitemuaythai.com | Muay Thai / BJJ | Volusia, FL |
| crossfitwestseattle.com | CrossFit | Seattle, WA |
| vccrossfit.com | CrossFit | Portland, OR |
| crossfitnordeast.com | CrossFit | Minneapolis, MN |

---

## 2. Infrastructure Failures

These sites consistently failed due to SSL, DNS, or timeout — not fixable by the scraper. Timeouts are marked "intermittent" if they scraped successfully in some passes.

| Site | Failure reason | Consistent? |
|---|---|---|
| jacksonwink.com | Timeout 30000ms | Yes (all 3 passes) |
| gleasonsgym.com | Timeout 30000ms | Yes (all 3 passes) |
| evolve-mma.com | Timeout 30000ms | Yes (all 3 passes) |
| crossfitnashville.com | Timeout 30000ms | Yes (all 3 passes) |
| crossfitnorthlondon.co.uk | Timeout 30000ms | Yes (all 3 passes) |
| crunch.com | Timeout 30000ms | Intermittent (pass-3/4 ok, pass-5 failed) |
| wildcardboxing.com | JS crash (pass-3 only) → fixed | Fixed in pass-4 |

---

## 3. Quality Results Table

### Scrape-level metrics (per pass, for sites that scraped)

#### Pass-3 (34 scraped / 40)

| Check | Pass | Fail |
|---|---|---|
| businessName present | 34 | 0 |
| sections >= 3 | 17 | 17 |
| zero bounding-box sections | 34 | 0 |
| navLinks >= 2 | 32 | 2 (10thplanetjj: 0, anytimefitness: 0) |
| colors >= 1 | 34 | 0 |
| fonts >= 1 | 34 | 0 |

#### Pass-3 — Docs quality (34 sites)

| Check | Pass | Fail |
|---|---|---|
| hier sections >= 3 | 17 | 17 |
| unknown tag <= 50% | 31 | 3 (soul-cycle: 93%, ufcgym: 60%, centralLondon: 53%) |
| ds_primary valid hex/rgb | 34 | 0 |
| ds_heading font present | 34 | 0 |

#### Pass-4 (35 scraped — wildcardboxing.com fixed)

| Check | Pass | Fail |
|---|---|---|
| businessName present | 35 | 0 |
| sections >= 3 | 18 | 17 |
| zero bounding-box sections | 35 | 0 |
| navLinks >= 2 | 33 | 2 |
| colors >= 1 | 35 | 0 |
| fonts >= 1 | 35 | 0 |

#### Pass-4 — Docs quality (35 sites)

| Check | Pass | Fail |
|---|---|---|
| hier sections >= 3 | 18 | 17 |
| unknown tag <= 50% | 33 | 2 (soul-cycle: 93%, ufcgym: 60%) |
| ds_primary valid hex/rgb | 35 | 0 |
| ds_heading font present | 35 | 0 |

#### Pass-5 (34 scraped — crunch.com timed out this pass)

| Check | Pass | Fail |
|---|---|---|
| businessName present | 34 | 0 |
| sections >= 3 | 17 | 17 |
| zero bounding-box sections | 34 | 0 |
| navLinks >= 2 | 32 | 2 |
| colors >= 1 | 34 | 0 |
| fonts >= 1 | 34 | 0 |

#### Pass-5 — Docs quality (34 sites)

| Check | Pass | Fail |
|---|---|---|
| hier sections >= 3 | 17 | 17 |
| unknown tag <= 50% | 32 | 2 (soul-cycle: 93%, ufcgym: 60%) |
| ds_primary valid hex/rgb | 34 | 0 |
| ds_heading font present | 34 | 0 |

---

## 4. Fixes Applied

### Fix 1 (pass-3) — `isGlobalChromeEl`: force-coerce `el.id` to string

**File:** `src/utils/scrape-website.ts`  
**Change:**
```ts
// Before:
const id = (el.id || "").toLowerCase();

// After:
const id = String(el.id || "").toLowerCase();
```
Applied to both `isLikelySectionRoot` and `isGlobalChromeEl` (same pattern, `replace_all`).

**Why generic:** In the browser, `el.id` on SVG elements or certain browser-generated DOM elements can return an `SVGAnimatedString` object rather than a plain string. The `||` short-circuit returns the object (truthy), and `.toLowerCase()` fails. Using `String(...)` coerces any type to a plain string safely — this applies broadly to any element where `el.id` may not be a primitive string.

**Impact:** Fixed the crash on wildcardboxing.com (pass-3 → pass-4: went from fail to 7 sections successfully extracted). Prevents similar crashes on future sites with SVG-heavy layouts.

**Verification:** `pnpm build` ✓, `255/255 tests` ✓

---

### Fix 2 (pass-3/4) — `inferTag`: heading/body keyword fallback for generic scraper types

**File:** `src/utils/site-hierarchy-builder.ts`  
**Change:** Added heading/body text keyword fallback after type-based matching fails. When `scraped.type` is a generic label like `"Text"` that yields no tag match, attempt to infer the section type from the actual heading and body content:

```ts
const heading = (scraped.heading ?? "").toLowerCase();
const body = (scraped.body ?? "").toLowerCase();
const combined = heading + " " + body;

if (/\bfaq\b|frequentl|question|answer/.test(combined)) return "faq-block";
if (/testimonial|review|real result|what (our|client|member)|said about|trust/.test(combined)) return "testimonial-band";
if (/our (location|address|gym|studio|facility)|located|visit us|find us|where we are/.test(combined)) return "location-block";
if (/step \d|how (it works|to (start|join|get started))|process|next step/.test(combined)) return "steps-band";
if (/\b(download|get the) (app|application)\b/.test(combined)) return "content-block";
if (/\b(about|philosophy|vision|mission|story|who we are|our team|instructors?|coaches?)\b/.test(combined) && body.length > 30) return "content-block";
if ((heading || body) && (scraped.images ?? []).length > 0) return "content-block";
if (heading && body.length > 30) return "content-block";
```

**Why generic:** Many gym site builders use generic section types ("Text", "Block", etc.) that carry no semantic information. The heading and body text is the actual signal. These keyword patterns are broad fitness/gym content patterns, not site-specific.

**Impact:** CrossFit Central London unknown rate: 8/15 (53% FAIL) → 4/15 (27% ok). CrossFit Austin: 2/4 (50%) → 0/4 ok. CrossFit West Seattle unknowns reduced. UFC Gym and SoulCycle unchanged (those sections have no content).

**Verification:** `pnpm build` ✓, `255/255 tests` ✓

---

### Fix 3 (pass-4/5) — `inferTag`: image-only sections → `media-block`

**File:** `src/utils/site-hierarchy-builder.ts`  
**Change:** Added final fallback: sections that have at least one image but no heading or body text should classify as `media-block` rather than `unknown`:

```ts
// A section with image(s) but no text is a visual accent — classify as media-block rather than unknown.
if ((scraped.images ?? []).length > 0) return "media-block";
```

**Why generic:** Visual accent sections (hero images, gallery rows, background panels) commonly appear with zero text content. Calling them `media-block` is semantically correct and applies universally across site builders.

**Impact:** CrossFit West Seattle 1/2 FAIL → 0/2 ok (the pure-image section now correctly tags as `media-block`).

**Verification:** `pnpm build` ✓, `255/255 tests` ✓

---

## 5. Remaining Issues — Human Review Required

### A. Persistent timeout sites (5 sites)

These sites consistently time out on `page.goto(..., 'networkidle')` across all three passes. The scraper's 30-second timeout is insufficient for these servers. Possible causes: heavy CDN anti-bot responses, very slow first-byte, or bot-detection 429s.

| Site | Passes failed |
|---|---|
| jacksonwink.com | pass-3, pass-4, pass-5 |
| gleasonsgym.com | pass-3, pass-4, pass-5 |
| evolve-mma.com | pass-3, pass-4, pass-5 |
| crossfitnashville.com | pass-3, pass-4, pass-5 |
| crossfitnorthlondon.co.uk | pass-3, pass-4, pass-5 |

**Possible fix (human):** Retry with `waitUntil: 'domcontentloaded'` instead of `'networkidle'`, or add a configurable per-URL timeout override.

### B. SPA sites with empty sections (2 sites)

| Site | Sections | Unknown % | Root cause |
|---|---|---|---|
| soul-cycle.com | 14 | 93% | React SPA — 12 sections have no heading AND no body text; content rendered client-side after hydration |
| ufcgym.com | 5 | 60% | 3 sections are structural placeholder divs with no text or images |

**Impact:** `unknown tag > 50%` quality check fails for both. No generic fix possible without site-specific DOM inspection or waiting for JS hydration. The sections exist because the DOM structure matches section heuristics, but the visible text isn't in the static HTML.

**Possible fix (human):** Add a post-hydration delay to the Playwright `page.waitForTimeout()` after `networkidle`, or scrape after the first paint is complete using `waitForSelector` on a known content element.

### C. Low section count (many sites)

17 sites have sections < 3. These are a mix of:
- **Single-section sites** (solidcore.co, rumbleboxing.com, crossfitsouthbrooklyn.com, 10thplanetjj.com): Entire page in one DOM container — Squarespace/Genesis/WordPress themes with a single outer wrapper. The fallback heuristic finds only 1 root.
- **SPA sites** (californiastrength.com, clubpilates.com, crossfitsydney.com.au, crossfitbondi.com.au, mbfitmiamibeach.com, tangletowncrossfit.com): Squarespace/Wix/Webflow apps that render minimal static HTML.
- **Simple landing pages** (americantopteam.com, crossfitwestseattle.com with 2 sections): Less than 3 distinct section blocks on the homepage.

**Possible fix (human):** Implement a min-height based fallback: after the existing `collectRoots` finds 0–1 roots, recursively descend body looking for sibling block elements with `getBoundingClientRect().height >= 200`. This would segment single-wrapper sites into their visible stacking blocks.

### D. Inaccurate business names (3 sites)

| Site | Detected | Actual | Cause |
|---|---|---|---|
| barrysbootcamp.com | "Fuel bar by barrys" | Barry's | "Fuel Bar" appears in hero alt text; domain redirects to barrys.com |
| anytimefitness.com | "A purple QR code with a running figure in the center." | Anytime Fitness | Logo alt text is an image description, not brand name |
| crossfitcentrallondon.co.uk | "Crossfitcentrallondon" | CrossFit Central London | og:site_name or title fallback uses domain slug |

**Note:** The scoreName() fix from pass-2 was applied for UI-descriptive logo alt text, but anytimefitness.com's logo alt is a visual description of a QR code image — a different pattern. Would require detecting and deprioritizing alt text that describes visual elements (colors, shapes) rather than brand names.

### E. Intermittent timeouts (1 site)

| Site | Behavior |
|---|---|
| crunch.com | Scraped successfully in pass-3 and pass-4, timed out in pass-5 |

This is likely a transient server issue, not a systematic problem. Should retry in subsequent passes.

---

## 6. Code Changes Summary

| File | Change | Applied before | Build | Tests |
|---|---|---|---|---|
| `src/utils/scrape-website.ts` | `String(el.id)` crash fix in `isGlobalChromeEl` + `isLikelySectionRoot` | pass-4 scrape | ✓ | 255/255 ✓ |
| `src/utils/site-hierarchy-builder.ts` | Heading/body keyword fallback in `inferTag` | pass-4 docs | ✓ | 255/255 ✓ |
| `src/utils/site-hierarchy-builder.ts` | Image-only → `media-block` fallback in `inferTag` | pass-5 docs | ✓ | 255/255 ✓ |

All changes are uncommitted local edits. No site-specific conditions were introduced.
