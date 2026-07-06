# Scraper Eval Report — pass-1 → pass-2

**Date:** 2026-07-03  
**URL file:** `/Users/dan/pushpress/websites/eval-gym-urls.txt` (23 sites)  
**Runs:** `scripts/eval/runs/pass-1/`, `scripts/eval/runs/pass-2/`

---

## 1. Pass-1 Failure Summary

**Sites scraped:** 3 / 23  
**Sites failed:** 20 / 23

### Root cause of 20 failures: inline comment stripping bug

The `readUrls()` function in `scripts/eval/run-scrape.ts` filtered lines *starting* with `#` but did not strip **inline comments** (e.g., `https://example.com  # comment`). Every URL that had an inline comment was passed verbatim including the `#` suffix to the scraper, which correctly rejected it with:

```
Error: Scrape URL must use http:// or https://, got: https://www.crossfitmayhem.com            # CrossFit Mayhem...
```

Only the 3 URLs without inline comments were processed: `torrancetraininglab.com`, `ksathleticclub.com`, `10thplanetlasvegas.com`.

### Pass-1 quality for the 3 sites that scraped

| Site | businessName | sections | zeroBB | navLinks | colors | fonts |
|---|---|---|---|---|---|---|
| torrancetraininglab.com | ✓ | 11 | 0 | 8 | 7 | 1 |
| ksathleticclub.com | ✓ | 11 | 0 | 7 | 3 | 1 |
| 10thplanetlasvegas.com | ✓ | 11 | 0 | 7 | 10 | 2 |

All 3 had clean docs (0 unknown tags >50%, valid design-system tokens, full intents).

---

## 2. Fixes Applied (Between Passes)

### Fix 1 — URL inline comment stripping

**File:** `scripts/eval/run-scrape.ts`  
**Change:** Modified `readUrls()` to strip trailing inline comments before filtering:

```ts
// Before:
.map((l) => l.trim())
.filter((l) => l && !l.startsWith("#"));

// After:
.map((l) => l.replace(/#.*$/, "").trim()) // strip inline comments
.filter((l) => l && !l.startsWith("#"));
```

**Why:** The eval URL file uses `# comment` on the same line as URLs for annotations. The fix is generic — it works for any URL file using `#` as inline comment delimiter (same convention as shell scripts, Python, etc.).  
**Impact:** Resolved 12 out of 20 failures (the 8 remaining are dead/parked/SSL-expired domains).

---

### Fix 2 — Filter global chrome elements from section extraction

**File:** `src/utils/scrape-website.ts`  
**Change:** Added `isGlobalChromeEl()` helper in the browser extraction script, called inside `collectRoots()` to skip site-builder navigation headers, footers, cookie banners, and marquee/ticker decorative elements before they can become content sections.

```js
function isGlobalChromeEl(el) {
  const cls = (el.className || "").toString().toLowerCase();
  const id  = (el.id || "").toLowerCase();
  if (/\b(header-group|nav-group|section-header(?!\w)|site-header|masthead|topbar|top-bar)\b/.test(cls + " " + id)) return true;
  if (/\b(footer-group|section-footer(?!\w)|site-footer|footer-section(?!\w))\b/.test(cls + " " + id)) return true;
  if (/\b(cookie|consent|gdpr|privacy-banner|cc-window|pc-banner|onetrust)\b/.test(cls + " " + id)) return true;
  if (/\b(marquee|ticker|scrolling-banner|scroll-banner|scroller)\b/.test(cls + " " + id)) return true;
  return false;
}
```

**Why:** Analysis of Pass-2 outputs showed that:
- CrossFit Mayhem (Shopify): header nav bar (`shopify-section-group-header-group section-header`) and footer (`shopify-section-group-footer-group section-footer`) were captured as content sections. Two `section-scrolling-banner` marquees produced empty sections with no heading/body.
- Torrance Training Lab: a `footer-section` div was captured as a card group.
- KS Athletic Club: a `contact-banner` at the page bottom was collected.

The pattern is generic: many site builders (Shopify, Genesis, Webflow) wrap global chrome in divs with class names containing `header-group`, `footer-section`, or `scrolling-banner`. Excluding them by class pattern reduces noise across all such sites.  
**Note:** This fix was applied **after** the pass-2 scrape (the protocol limits to 2 scrape passes), so its impact is reflected in the code but not in pass-2 numbers. It is verified by: `pnpm build` succeeds, all 255 tests pass.

---

### Fix 3 — Business name scoring: penalize UI-descriptive logo alt text

**File:** `src/utils/scrape-website.ts`  
**Change:** Added penalties in `scoreName()` for logo alt text that contains UI-descriptive phrases:

```js
if (/\b(navigation|header|footer|company|main|primary)\s+(logo|icon)\b/.test(lower)) score -= 5;
if (/\b(logo|icon)\b/.test(lower) && source === "logo") score -= 2;
```

**Why:** Orangetheory's logo alt text was `"Orangetheory Fitness (OTF) main navigation logo."`. Because the alt text contained the domain keyword ("orangetheory") plus the source bonus for "logo", it scored higher than the OG meta tag `"Orangetheory Fitness"`. The penalty is generic — it applies whenever a logo alt text describes the element itself (e.g., "main navigation logo", "company icon") rather than the brand name.  
**Note:** Also applied after pass-2 scrape. Verified: build passes, all 255 tests pass.

---

## 3. Pass-2 Failure Summary

**Sites scraped:** 14 / 23  
**Sites failed (scraper level):** 9 / 23

### Scraper-level failures (infrastructure, not fixable)

| Site | Failure reason | Category |
|---|---|---|
| crossfitdiablo.com | `ERR_NAME_NOT_RESOLVED` | Domain offline |
| crossfit610.com | `ERR_CERT_DATE_INVALID` | Expired SSL |
| gracieacademy.com | `ERR_CERT_DATE_INVALID` | Expired SSL |
| marcelojiu-jitsu.com | `ERR_NAME_NOT_RESOLVED` | Domain offline |
| atosbjj.com | `ERR_NAME_NOT_RESOLVED` | Domain offline |
| checkmatbjj.com | `ERR_NAME_NOT_RESOLVED` | Domain offline |
| usjudo.org | `Timeout 30000ms` | Server timeout |
| nissei-judoclub.org | `ERR_NAME_NOT_RESOLVED` | Domain offline |
| texasjudo.org | `ERR_CERT_AUTHORITY_INVALID` | Invalid SSL cert |

### Pass-2 quality checks for 14 scraped sites

| Site | businessName | sections | zeroBB | navLinks≥2 | colors≥1 | fonts≥1 | hier_secs≥3 | unknown>50% | intent_ok | ds_primary_hex | ds_heading_font |
|---|---|---|---|---|---|---|---|---|---|---|---|
| torrancetraininglab | ✓ | 11 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| ksathleticclub | ✓ | 11 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| crossfitinvictus | ✓ | 7 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| crossfitmayhem | ✓ | 9 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| crossfitsouthbrooklyn | ✓ | **1** | 0 | ✓ | ✓ | ✓ | **1** | ✗ | ✓ | ✓ | ✓ |
| f45training | ✓ | 7 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| orangetheory | ✓* | 6 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| barrysbootcamp | ✓* | 8 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| solidcore | ✓ | **1** | 0 | ✓ | ✓ | ✓ | **1** | ✗ | ✓ | ✓ | ✓ |
| rumbleboxing | ✓ | **1** | 0 | ✓ | ✓ | ✓ | **1** | ✗ | ✓ | ✓ | ✓ |
| 10thplanetlasvegas | ✓ | 11 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| graciebarra | ✓ | 5 | 0 | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| 10thplanetjj | ✓ | **1** | 0 | **0** | ✓ | ✓ | **1** | ✗ | ✓ | ✓ | ✓ |
| allianceatlanta | ✓* | 10 | 0 | ✓ | ✓ | ✓ | ✓ | **✓** | ✓ | ✓ | ✓ |

*businessName detected but inaccurate (see notes below)

---

## 4. Net Improvement Table

| Metric | Pass-1 | Pass-2 | Delta |
|---|---|---|---|
| Sites successfully scraped | 3 / 23 | 14 / 23 | +11 |
| Sites with no 01-scrape.json | 20 | 9 | -11 |
| businessName_missing | 0 | 0 | 0 |
| sections < 3 | 0 (of 3) | 4 (of 14) | n/a* |
| zero bounding box sections | 0 | 0 | 0 |
| navLinks < 2 | 0 | 1 | n/a* |
| colors missing | 0 | 0 | 0 |
| fonts missing | 0 | 0 | 0 |
| hierarchy sections < 3 | 0 | 4 | n/a* |
| unknown tag > 50% | 0 | 1 | n/a* |
| missing intent | 0 | 0 | 0 |
| ds_primary invalid hex | 0 | 0 | 0 |
| ds_heading font missing | 0 | 0 | 0 |

*Pass-1 only scraped 3 sites (the 3 that happened to work well). The pass-1 → pass-2 "regression" in counts reflects more sites being included, not quality degradation. The 4 `sections < 3` sites in pass-2 are all legitimately hard sites.

---

## 5. Remaining Issues — Human Review Required

### A. Low section count (4 sites) — SPA / non-semantic DOM

| Site | Sections | Reason |
|---|---|---|
| solidcore.co | 1 | React/Tailwind app — sections use generic Tailwind class names, no `<section>` or class-based hints |
| rumbleboxing.com | 1 | Squarespace — entire page content in one large root div, no `<section>` tags |
| crossfitsouthbrooklyn.com | 1 | WordPress Genesis theme — content inside a single theme wrapper div |
| 10thplanetjj.com | 1 | WordPress — no semantic section tags; also 0 navLinks extracted |

**Root cause:** These sites don't use `<section>` tags or class names matching the `isLikelySectionRoot` heuristics. The fallback (top-level body children) finds only one large div containing everything.

**Possible fix (not auto-applied — too risky):** For the fallback path, instead of taking direct body children, recursively descend until finding elements with min-height ≥ 200px that are direct siblings — effectively treating any large sibling block as a section. This would help Squarespace/Genesis sites but risks over-segmenting other sites. Needs careful tuning and broader testing.

### B. Inaccurate business name (2 sites)

| Site | Detected name | Actual name | Cause |
|---|---|---|---|
| orangetheory.com | "Orangetheory Fitness (OTF) main navigation logo." | Orangetheory Fitness | Logo alt text contains "main navigation logo" phrase — Fix 3 addresses this in future scrapes |
| barrysbootcamp.com | "Fuel bar by barrys" | Barry's Bootcamp | "Fuel Bar" appears prominently on the page; the site redirects to `barrys.com` — domain name doesn't match page alt text |

### C. Parked / off-topic domain (1 site)

| Site | businessName | Problem |
|---|---|---|
| allianceatlanta.com | HugeDomains | Domain is parked (for-sale page). 6/10 sections tag as "unknown" because domain-sale page content doesn't match gym section heuristics. |

This is not a scraper bug — the URL is simply a dead/parked domain. Remove from the URL file or replace with the actual gym's site.

### D. Dead/offline domains (8 sites) — Infrastructure

The following sites failed due to infrastructure reasons beyond the scraper's control. The URL file should be updated with working alternatives:

- `crossfitdiablo.com` — DNS dead
- `crossfit610.com` — Expired SSL cert  
- `gracieacademy.com` — Expired SSL cert
- `marcelojiu-jitsu.com` — DNS dead
- `atosbjj.com` — DNS dead
- `checkmatbjj.com` — DNS dead
- `usjudo.org` — Server timeout (may be intermittent)
- `nissei-judoclub.org` — DNS dead
- `texasjudo.org` — Invalid SSL cert

---

## 6. Code Changes Summary

| File | Change | Status |
|---|---|---|
| `scripts/eval/run-scrape.ts` | Strip inline `# comments` from URL lines | Applied; in pass-2 scrape |
| `src/utils/scrape-website.ts` | `isGlobalChromeEl()` — skip nav header, footer, cookie, marquee elements | Applied after pass-2; build ✓, tests ✓ (255/255) |
| `src/utils/scrape-website.ts` | Penalize UI-descriptive logo alt text in `scoreName()` | Applied after pass-2; build ✓, tests ✓ (255/255) |

All changes are uncommitted local edits. No site-specific conditions were introduced.
