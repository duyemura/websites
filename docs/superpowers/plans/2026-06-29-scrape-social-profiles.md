# Scrape social media profiles into External profiles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect common social media profile links while scraping a gym website and surface them in the business info doc's `## External profiles` section.

**Architecture:** Add a small, testable pure function that maps URLs to known social platforms. The browser extraction script scans anchor tags for matching hosts and returns `{ platform, url }[]`. The doc generator merges those links with GMB-derived Google Maps / Website links under a single `## External profiles` section.

**Tech Stack:** TypeScript, Vitest, Playwright browser script string, existing `apps/api/src/utils/scrape-website.ts` + `apps/api/src/utils/site-docs.ts`.

---

### Task 1: Create social profile detector utility

**Files:**
- Create: `apps/api/src/utils/social-links.ts`
- Test: `apps/api/test/utils/social-links.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, test, expect } from "vitest";
import { detectSocialPlatform, extractSocialProfiles } from "../../src/utils/social-links";

describe("detectSocialPlatform", () => {
  test("identifies common social platforms", () => {
    expect(detectSocialPlatform("https://www.instagram.com/betagym")).toBe("Instagram");
    expect(detectSocialPlatform("https://facebook.com/betagym")).toBe("Facebook");
    expect(detectSocialPlatform("https://www.youtube.com/@betagym")).toBe("YouTube");
    expect(detectSocialPlatform("https://youtu.be/abc123")).toBe("YouTube");
    expect(detectSocialPlatform("https://tiktok.com/@betagym")).toBe("TikTok");
    expect(detectSocialPlatform("https://x.com/betagym")).toBe("X");
    expect(detectSocialPlatform("https://twitter.com/betagym")).toBe("X");
    expect(detectSocialPlatform("https://www.linkedin.com/company/betagym")).toBe("LinkedIn");
    expect(detectSocialPlatform("https://pinterest.com/betagym")).toBe("Pinterest");
    expect(detectSocialPlatform("https://www.snapchat.com/add/betagym")).toBe("Snapchat");
    expect(detectSocialPlatform("https://reddit.com/r/betagym")).toBe("Reddit");
    expect(detectSocialPlatform("https://threads.net/@betagym")).toBe("Threads");
    expect(detectSocialPlatform("https://www.yelp.com/biz/betagym")).toBe("Yelp");
    expect(detectSocialPlatform("https://wa.me/15551234")).toBe("WhatsApp");
    expect(detectSocialPlatform("https://t.me/betagym")).toBe("Telegram");
    expect(detectSocialPlatform("https://discord.gg/betagym")).toBe("Discord");
    expect(detectSocialPlatform("https://www.twitch.tv/betagym")).toBe("Twitch");
    expect(detectSocialPlatform("https://vimeo.com/betagym")).toBe("Vimeo");
  });

  test("returns null for non-social urls", () => {
    expect(detectSocialPlatform("https://example-gym.com/classes")).toBeNull();
    expect(detectSocialPlatform("mailto:hi@example.com")).toBeNull();
    expect(detectSocialPlatform("tel:5551234")).toBeNull();
  });
});

describe("extractSocialProfiles", () => {
  test("deduplicates and preserves order", () => {
    const urls = [
      "https://instagram.com/betagym",
      "https://www.instagram.com/betagym",
      "https://facebook.com/betagym",
      "https://example-gym.com/classes",
    ];
    const profiles = extractSocialProfiles(urls);
    expect(profiles).toEqual([
      { platform: "Instagram", url: "https://instagram.com/betagym" },
      { platform: "Facebook", url: "https://facebook.com/betagym" },
    ]);
  });
});
```

Run: `pnpm test apps/api/test/utils/social-links.test.ts`
Expected: FAIL — module or functions not found.

- [ ] **Step 2: Implement the detector**

```typescript
export interface SocialProfile {
  platform: string;
  url: string;
}

const PLATFORM_PATTERNS: { platform: string; hostRe: RegExp }[] = [
  { platform: "YouTube", hostRe: /^(www\.)?(youtube\.com|youtu\.be)$/i },
  { platform: "Instagram", hostRe: /^(www\.)?instagram\.com$/i },
  { platform: "Facebook", hostRe: /^(www\.)?facebook\.com$/i },
  { platform: "TikTok", hostRe: /^(www\.)?tiktok\.com$/i },
  { platform: "X", hostRe: /^(www\.)?(twitter\.com|x\.com)$/i },
  { platform: "LinkedIn", hostRe: /^(www\.)?linkedin\.com$/i },
  { platform: "Pinterest", hostRe: /^(www\.)?pinterest\.com$/i },
  { platform: "Snapchat", hostRe: /^(www\.)?snapchat\.com$/i },
  { platform: "Reddit", hostRe: /^(www\.)?reddit\.com$/i },
  { platform: "Threads", hostRe: /^(www\.)?threads\.net$/i },
  { platform: "Yelp", hostRe: /^(www\.)?yelp\.com$/i },
  { platform: "WhatsApp", hostRe: /^(www\.)?wa\.me$/i },
  { platform: "Telegram", hostRe: /^(www\.)?t\.me$/i },
  { platform: "Discord", hostRe: /^(www\.)?discord\.(com|gg)$/i },
  { platform: "Twitch", hostRe: /^(www\.)?twitch\.tv$/i },
  { platform: "Vimeo", hostRe: /^(www\.)?vimeo\.com$/i },
];

export function detectSocialPlatform(url: string): string | null {
  try {
    const parsed = new URL(url);
    for (const p of PLATFORM_PATTERNS) {
      if (p.hostRe.test(parsed.hostname)) {
        return p.platform;
      }
    }
  } catch {
    // invalid URL
  }
  return null;
}

export function extractSocialProfiles(urls: string[]): SocialProfile[] {
  const seen = new Set<string>();
  const result: SocialProfile[] = [];
  for (const url of urls) {
    const platform = detectSocialPlatform(url);
    if (!platform) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    result.push({ platform, url });
  }
  return result;
}
```

Run: `pnpm test apps/api/test/utils/social-links.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/utils/social-links.ts apps/api/test/utils/social-links.test.ts
git commit -m "feat(api): add testable social profile detector"
```

---

### Task 2: Extract social links during website scrape

**Files:**
- Modify: `apps/api/src/utils/scrape-website.ts`

- [ ] **Step 1: Write the failing test**

Extend `apps/api/test/utils/site-docs.test.ts` base scrape data with multiple social URLs and assert `generateSiteDocs` puts them under `## External profiles`. Run the test; it should fail because the scraper does not yet populate `contact.social` from the website.

```typescript
const baseScrape: ScrapedWebsiteData = {
  // ... existing fields ...
  contact: {
    phone: "555-1234",
    email: "hi@example-gym.com",
    social: [
      { platform: "Instagram", url: "https://instagram.com/betagym" },
      { platform: "Facebook", url: "https://facebook.com/betagym" },
      { platform: "YouTube", url: "https://youtube.com/@betagym" },
    ],
  },
};
```

Add to existing business-info test:
```typescript
expect(businessInfo.content).toContain("## External profiles");
expect(businessInfo.content).toContain("https://instagram.com/betagym");
expect(businessInfo.content).toContain("https://facebook.com/betagym");
expect(businessInfo.content).toContain("https://youtube.com/@betagym");
```

Run: `pnpm test apps/api/test/utils/site-docs.test.ts`
Expected: FAIL — the External profiles section is missing scraped social URLs.

- [ ] **Step 2: Add social link extraction to browser script**

Inside the `BROWSER_EXTRACTION_SCRIPT` in `scrape-website.ts`, before the final `return`, add:

```javascript
  const socialPatterns = [
    { platform: "YouTube", re: /youtube\.com|youtu\.be/i },
    { platform: "Instagram", re: /instagram\.com/i },
    { platform: "Facebook", re: /facebook\.com/i },
    { platform: "TikTok", re: /tiktok\.com/i },
    { platform: "X", re: /twitter\.com|x\.com/i },
    { platform: "LinkedIn", re: /linkedin\.com/i },
    { platform: "Pinterest", re: /pinterest\.com/i },
    { platform: "Snapchat", re: /snapchat\.com/i },
    { platform: "Reddit", re: /reddit\.com/i },
    { platform: "Threads", re: /threads\.net/i },
    { platform: "Yelp", re: /yelp\.com/i },
    { platform: "WhatsApp", re: /wa\.me/i },
    { platform: "Telegram", re: /t\.me/i },
    { platform: "Discord", re: /discord\.(com|gg)/i },
    { platform: "Twitch", re: /twitch\.tv/i },
    { platform: "Vimeo", re: /vimeo\.com/i },
  ];

  const seenSocial = new Set();
  const socialLinks = [];
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    const href = a.href;
    if (!href || !href.startsWith("http")) continue;
    for (const p of socialPatterns) {
      if (p.re.test(href) && !seenSocial.has(href)) {
        seenSocial.add(href);
        socialLinks.push({ platform: p.platform, url: href });
        break;
      }
    }
  }
```

Add `socialLinks: { platform: string; url: string }[]` to the `BrowserExtractionResult` interface and include `socialLinks` in the final `return` object.

- [ ] **Step 3: Wire scrapeWebsite to contact.social**

In `scrapeWebsite`, change `contact: {}` to:

```typescript
contact: {
  social: extracted.socialLinks,
},
```

Run: `pnpm test apps/api/test/utils/site-docs.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/utils/scrape-website.ts apps/api/test/utils/site-docs.test.ts
git commit -m "feat(api): extract social links during website scrape"
```

---

### Task 3: Merge scraped social links into External profiles doc section

**Files:**
- Modify: `apps/api/src/utils/site-docs.ts`

- [ ] **Step 1: Write the failing test**

If not already covered, add a test asserting that when `gmb` is absent, scraped social links still produce an `## External profiles` section:

```typescript
test("business info surfaces scraped social links under External profiles without gmb", () => {
  const docs = generateSiteDocs(baseScrape);
  const businessInfo = docs.find((d) => d.key === "business-info")!;
  expect(businessInfo.content).toContain("## External profiles");
  expect(businessInfo.content).toContain("Instagram: https://instagram.com/betagym");
});
```

Run: `pnpm test apps/api/test/utils/site-docs.test.ts`
Expected: FAIL — the current code only emits External profiles when `gmb.googleMapsUri` or `gmb.websiteUri` exist.

- [ ] **Step 2: Update makeBusinessInfoDoc**

Replace the existing External profiles block with one that always includes scraped social links:

```typescript
  const externalProfiles: { label: string; url: string }[] = [];
  if (gmb?.googleMapsUri) externalProfiles.push({ label: "Google Maps", url: gmb.googleMapsUri });
  if (gmb?.websiteUri) externalProfiles.push({ label: "Website", url: gmb.websiteUri });
  for (const social of scraped.contact?.social ?? []) {
    externalProfiles.push({ label: social.platform, url: social.url });
  }

  if (externalProfiles.length > 0) {
    lines.push("", "## External profiles", "");
    for (const p of externalProfiles) {
      lines.push(`- ${p.label}: ${p.url}`);
    }
  }
```

Then replace the "## Contact" social block so it only shows phone/email:

```typescript
  const hasPhone = gmb?.phoneNumber || scraped.contact?.phone;
  const hasEmail = scraped.contact?.email;
  if (hasPhone || hasEmail) {
    lines.push("", "## Contact", "");
    if (gmb?.phoneNumber) lines.push(`- **Phone**: ${gmb.phoneNumber}`);
    else if (scraped.contact?.phone) lines.push(`- **Phone**: ${scraped.contact.phone}`);
    if (scraped.contact?.email) lines.push(`- **Email**: ${scraped.contact.email}`);
  }
```

Run: `pnpm test apps/api/test/utils/site-docs.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/utils/site-docs.ts apps/api/test/utils/site-docs.test.ts
git commit -m "feat(api): merge scraped social links into External profiles section"
```

---

### Task 4: Run tests and validate

- [ ] **Step 1: Run affected tests**

```bash
pnpm test apps/api/test/utils/social-links.test.ts apps/api/test/utils/site-docs.test.ts
```

Expected: all tests PASS, output pristine.

- [ ] **Step 2: Run the api test suite**

```bash
pnpm --filter apps/api test
```

Expected: all tests PASS.

- [ ] **Step 3: Final commit if any fixes were needed**

If no fixes were needed, no additional commit. If fixes were required, commit them with a concise message.

---

## Spec coverage

- Detect YouTube, Instagram, Facebook, TikTok, X, LinkedIn, Pinterest, Snapchat, Reddit, Threads, Yelp, WhatsApp, Telegram, Discord, Twitch, Vimeo → Task 1 detector patterns.
- Extract links from scraped website → Task 2 browser script.
- Surface in `## External profiles` alongside GMB and website → Task 3 doc generator change.

## Placeholder scan

No placeholders; every step includes exact file paths, code blocks, and commands.

## Type consistency

- `contact.social` is already typed as `{ platform: string; url: string }[]` in `ScrapedWebsiteData`.
- `BrowserExtractionResult` adds `socialLinks` with the same shape.
- `externalProfiles` local array uses `{ label: string; url: string }` for rendering only.
