import type { Page, Browser } from "playwright";
import type {
  ScrapedColor,
  ScrapedDesignToken,
  ScrapedFont,
  ScrapedImage,
  ScrapedTextStyle,
} from "@ploy-gyms/shared-types";
import type { ScrapedWebsiteData } from "./scrape-docs";
import type { SectionVisualEvidenceRow } from "../types/section-visual-evidence";
import { dedupeFaqs } from "./faqs";
import { extractSocialProfiles } from "./social-links";
import { isHttpUrl } from "./http-url";

const CSS_ARTIFACT_PATTERN = /^\s*[*.#[@:\w-]+\s*\{/;
const MAX_NAV_LABEL_LENGTH = 60;

function isCleanNavLink(link: { label: string; href: string }): boolean {
  const label = link.label.trim();
  if (!label || label.length > MAX_NAV_LABEL_LENGTH) return false;
  if (CSS_ARTIFACT_PATTERN.test(label)) return false;
  if (label.startsWith("<") || label.startsWith("{") || label.startsWith("//")) return false;
  return true;
}

function cleanNavLinks(links: { label: string; href: string }[]): { label: string; href: string }[] {
  return links.filter(isCleanNavLink).map((link) => ({ label: link.label.trim(), href: link.href }));
}

export interface ScrapeOptions {
  url: string;
  takeScreenshot?: boolean;
  screenshotPath?: string;
  captureHtml?: boolean;
  maxWaitMs?: number;
}

interface ComputedStyleSample {
  selector: string;
  tagName: string;
  text: string;
  className: string;
  area: number;
  backgroundColor: string;
  color: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  textTransform: string;
  borderRadius: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderColor: string;
  padding: string;
  margin: string;
  maxWidth: string;
  boxShadow: string;
}

interface ColorCandidate {
  hex: string;
  count: number;
  contexts: string[];
}

interface ScrapedSection {
  id: string;
  type: string;
  heading?: string;
  body?: string;
  intent?: string;
  cta?: { label: string; href: string };
  visualEvidence: SectionVisualEvidenceRow;
  items?: { title?: string; description?: string; imageUrl?: string }[];
  images?: { url: string; alt?: string; context?: string }[];
  styleHint?: {
    theme?: "dark" | "light";
    centered?: boolean;
    columns?: number;
    imagePosition?: "left" | "right" | "background" | "none";
    sourceOrder?: number;
    align?: "left" | "center" | "right";
    eyebrow?: string;
    uppercase?: boolean;
    ctaStyle?: "primary" | "dark" | "outline";
    heroTextColor?: string;
    heroCtaBg?: string;
    heroCtaColor?: string;
    heroCtaRadius?: string;
    heroCtaHasIcon?: boolean;
    heroCtaUppercase?: boolean;
    heroCtaBold?: boolean;
    heroCtaTransform?: string;
    heroCtaPadding?: string;
    subtitleUppercase?: boolean;
    eyebrowBg?: string;
    eyebrowColor?: string;
    eyebrowPadding?: string;
  };
}

interface BrowserExtractionResult {
  samples: ComputedStyleSample[];
  extraColors: { hex: string; context: string; area: number }[];
  headings: string[];
  paragraphs: string[];
  buttons: string[];
  navLinks: { label: string; href: string }[];
  businessName: string;
  tagline: string;
  images: ScrapedImage[];
  headerCtaStyle?: {
    bg?: string;
    color?: string;
    radius?: string;
    padding?: string;
    uppercase?: boolean;
    bold?: boolean;
    light?: boolean;
    fontSize?: string;
  };
  faqs: { question: string; answer: string }[];
  offerings: { name?: string; description?: string; price?: string }[];
  locations: { name?: string; address?: string; hours?: string }[];
  team: { name?: string; role?: string; bio?: string }[];
  testimonials: { quote: string; author?: string; role?: string }[];
  grids: { columns: number; element: string; className: string }[];
  distinctiveComponents: { type: string; label: string }[];
  externalLinks: string[];
  sections: ScrapedSection[];
}

// Browser-side extraction as a string so esbuild/tsx function-name transforms
// (e.g. __name) do not leak into the browser context.
const BROWSER_EXTRACTION_SCRIPT = String.raw`
(function() {
  function colorToHex(color) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return null;
    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);
    const a = match[4] ? parseFloat(match[4]) : 1;
    if (a < 0.05) return null;
    return "#" + [r, g, b].map(function(v) { return v.toString(16).padStart(2, "0"); }).join("").toUpperCase();
  }

  function colorsFromGradient(image) {
    const colors = [];
    const rgbMatches = image.match(/rgba?\([^)]+\)/g) || [];
    for (const m of rgbMatches) {
      const hex = colorToHex(m);
      if (hex) colors.push(hex);
    }
    const hexMatches = image.match(/#[0-9A-Fa-f]{3,8}/g) || [];
    for (const m of hexMatches) {
      const normalized = m.length === 4 ? "#" + m[1] + m[1] + m[2] + m[2] + m[3] + m[3] : m;
      colors.push(normalized.toUpperCase());
    }
    return colors;
  }

  const selectors = [
    "body", "body > div", "header", "main", "section", "footer",
    "h1", "h2", "h3", "h4", "p", "a", "button", "nav", "input",
    ".btn", "[class*='button']", "[class*='cta']", "[class*='accent']",
    "[class*='hero']", "[class*='card']", "svg"
  ].join(", ");
  const elements = Array.from(document.querySelectorAll(selectors));
  const extraColors = [];

  const samples = elements.slice(0, 120).map(function(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    const className = (el.className || "").toString();
    const lowerClass = className.toLowerCase();
    // Skip absolute overlays/backdrops; their dark color often masquerades as the page background.
    if (lowerClass.includes("overlay") || lowerClass.includes("backdrop")) {
      return null;
    }
    const isButton =
      el.tagName === "BUTTON" ||
      lowerClass.includes("button") ||
      lowerClass.includes("btn");

    for (const pseudo of ["::before", "::after"]) {
      const pseudoStyle = window.getComputedStyle(el, pseudo);
      const pseudoColor = colorToHex(pseudoStyle.backgroundColor);
      if (pseudoColor) {
        extraColors.push({ hex: pseudoColor, context: isButton ? "button background" : "background", area });
      }
      for (const c of colorsFromGradient(pseudoStyle.backgroundImage)) {
        extraColors.push({ hex: c, context: isButton ? "button background" : "background", area });
      }
    }

    for (const c of colorsFromGradient(style.backgroundImage)) {
      extraColors.push({ hex: c, context: isButton ? "button background" : "background", area });
    }

    return {
      selector: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
      tagName: el.tagName,
      className: className,
      text: (el.textContent || "").trim().slice(0, 40),
      area: area,
      backgroundColor: style.backgroundColor,
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      textTransform: style.textTransform,
      borderRadius: style.borderRadius,
      borderTopWidth: style.borderTopWidth,
      borderRightWidth: style.borderRightWidth,
      borderBottomWidth: style.borderBottomWidth,
      borderLeftWidth: style.borderLeftWidth,
      borderColor: style.borderColor,
      padding: style.paddingTop + " " + style.paddingRight + " " + style.paddingBottom + " " + style.paddingLeft,
      margin: style.marginTop + " " + style.marginRight + " " + style.marginBottom + " " + style.marginLeft,
      maxWidth: style.maxWidth,
      boxShadow: style.boxShadow,
    };
  }).filter(Boolean);

  // Capture CSS custom properties that resolve to colors.
  const rootStyle = window.getComputedStyle(document.documentElement);
  const bodyStyle = window.getComputedStyle(document.body);
  const varNames = [];
  for (let i = 0; i < rootStyle.length; i++) {
    const name = rootStyle[i];
    if (name.startsWith("--")) varNames.push(name);
  }
  for (let i = 0; i < bodyStyle.length; i++) {
    const name = bodyStyle[i];
    if (name.startsWith("--") && !varNames.includes(name)) varNames.push(name);
  }
  for (const name of varNames.slice(0, 60)) {
    const value = rootStyle.getPropertyValue(name) || bodyStyle.getPropertyValue(name);
    const hex = colorToHex(value);
    if (!hex) continue;
    const lower = name.toLowerCase();
    let area = 500;
    if (lower.includes("accent") || lower.includes("primary") || lower.includes("brand") || lower.includes("cta")) {
      area = 10000;
    } else if (lower.includes("white") || lower.includes("black") || lower.includes("gray") || lower.includes("neutral") || lower.includes("muted") || lower.includes("secondary")) {
      area = 100;
    } else if (lower.includes("background") || lower.includes("surface")) {
      area = 2000;
    } else if (lower.includes("text") || lower.includes("heading")) {
      area = 500;
    }
    extraColors.push({ hex: hex, context: "css variable " + name, area: area });
  }

  // Capture SVG fill/stroke colors.
  const svgs = Array.from(document.querySelectorAll("svg, svg *"));
  for (const el of svgs.slice(0, 40)) {
    const style = window.getComputedStyle(el);
    for (const prop of ["fill", "stroke"]) {
      const val = style.getPropertyValue(prop);
      const hex = colorToHex(val);
      if (hex) {
        extraColors.push({ hex: hex, context: "svg " + prop, area: 1000 });
      }
    }
  }

  // Capture accent-seeking selectors explicitly.
  const accentSelectors = [
    "[class*='red']", "[class*='brand']", "[class*='primary']",
    "[style*='red']", "[style*='#e2']", "[class*='badge']", "[class*='tag']",
  ];
  for (const sel of accentSelectors) {
    for (const el of Array.from(document.querySelectorAll(sel)).slice(0, 10)) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      for (const c of [style.backgroundColor, style.color, style.borderColor]) {
        const hex = colorToHex(c);
        if (hex) extraColors.push({ hex: hex, context: "accent candidate", area: Math.max(area, 500) });
      }
    }
  }

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map(function(el) { return (el.textContent || "").trim(); })
    .filter(function(t) { return t.length > 0 && t.length < 200; })
    .slice(0, 20);

  const paragraphs = Array.from(document.querySelectorAll("p, .description, [class*='lead']"))
    .map(function(el) { return (el.textContent || "").trim(); })
    .filter(function(t) { return t.length > 40 && t.length < 300; })
    .slice(0, 15);

  const buttons = Array.from(document.querySelectorAll(
    "button, a[class*='button'], a[class*='btn'], [role='button'], a[class*='cta']"
  ))
    .map(function(el) { return (el.textContent || "").trim(); })
    .filter(function(t) { return t.length > 0 && t.length < 80; })
    .slice(0, 15);

  const navAnchors = Array.from(document.querySelectorAll("header a, nav a, [role='navigation'] a"));
  const seenLabels = new Set();
  const navLinks = navAnchors
    .map(function(el) {
      return {
        label: ((el.textContent || "").trim().split("\n")[0] || "").trim(),
        href: el.href || "#",
      };
    })
    .filter(function(l) {
      if (l.label.length === 0 || l.label.length > 40) return false;
      if (seenLabels.has(l.label)) return false;
      seenLabels.add(l.label);
      return true;
    })
    .slice(0, 8);

  function detectHeaderCtaStyle() {
    const header = document.querySelector("header, [role='banner'], .navbar, .nav");
    if (!header) return undefined;
    const candidates = Array.from(header.querySelectorAll("a[class*='cta'], a[class*='button'], a[class*='btn'], button"));
    const visible = candidates.filter(function(el) {
      const rect = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (s.display === "none" || s.visibility === "hidden") return false;
      const opacity = parseFloat(s.opacity || "1");
      if (isNaN(opacity) || opacity < 0.05) return false;
      return true;
    });
    function isOnTop(el) {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return top === el || el.contains(top);
    }
    const onTop = visible.filter(isOnTop);
    const pool = onTop.length > 0 ? onTop : visible;
    const ordered = pool.slice().sort(function(a, b) {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    });
    const cta = ordered[0];
    if (!cta) return undefined;
    const textEl = cta.querySelector("p, span, .text, [class*='text']") || cta;
    const textStyle = window.getComputedStyle(textEl);
    const btnStyle = window.getComputedStyle(cta);
    const bgEl = Array.from(cta.querySelectorAll("*")).find(function(child) {
      const bg = window.getComputedStyle(child).backgroundColor;
      return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    });
    const bgStyle = bgEl ? window.getComputedStyle(bgEl) : btnStyle;
    const transform = (textStyle.textTransform || "").toLowerCase();
    const weight = parseInt(textStyle.fontWeight || "0", 10);
    return {
      bg: rgbToHex(bgStyle.backgroundColor),
      color: rgbToHex(textStyle.color),
      radius: bgStyle.borderRadius,
      padding: btnStyle.padding,
      fontSize: textStyle.fontSize,
      uppercase: transform === "uppercase",
      bold: weight >= 700,
      light: weight < 400 && weight > 0,
    };
  }

  const headerCtaStyle = detectHeaderCtaStyle();

  function titleCase(words) {
    return words.map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }).join(" ");
  }

  function nameFromDomain() {
    try {
      const host = document.location.hostname.replace(/^www\./, "").toLowerCase();
      const namePart = host.replace(/\.(com|org|net|co\.[a-z]+|io|app|ai|us|ca|fitness|gym)$/, "");
      // Split on hyphens/underscores and camelCase boundaries for names like "torranceTrainingLab"
      const splitCamel = namePart.replace(/([a-z])([A-Z])/g, "$1 $2");
      const words = splitCamel.split(/[-_\s]/).filter(function(w) { return w.length > 1; });
      if (words.length === 0) return "";
      return titleCase(words);
    } catch (e) {
      return "";
    }
  }

  function scoreName(name, allText, source) {
    if (!name || name.length < 3 || name.length > 120) return 0;
    const lower = name.toLowerCase();
    const stop = new Set(["the","of","in","and","for","to","on","a","an","home","official","website","site","logo","welcome","welcome to"]);
    const words = lower.split(/\s+/).filter(function(w) { return w.length > 1 && !stop.has(w); });
    const unique = new Set(words);
    let score = Math.min(unique.size, 5);

    // Source trust tiers
    if (source === "jsonld") score += 4; // schema.org is the canonical business source
    if (source === "og") score += 3;   // og:site_name is usually editorially set
    if (source === "logo" || source === "domain") score += 2;
    if (source === "title") score += 0; // title is often SEO-stuffed, trust it least

    // Bonus if the candidate appears in visible page text (headings, paragraphs)
    if (allText.includes(lower)) score += 2;

    // Strong bonus when the candidate words match the domain/hostname root.
    const domainRoot = document.location.hostname.replace(/^www\./, "").split(".")[0] || "";
    const domainWords = domainRoot.toLowerCase().split(/[-_\s]/).filter(function(w) { return w.length > 2; });
    const candidateWords = lower.split(/\s+/).filter(function(w) { return w.length > 2; });
    const domainMatches = candidateWords.filter(function(w) { return domainWords.indexOf(w) !== -1; }).length;
    score += domainMatches * 3;

    // Penalty for vague location-only names like "Torrance Gym"
    const genericSuffixes = ["gym","fitness","training","studio","club","center","health","wellness","sports"];
    const lastWord = lower.split(/\s+/).pop() || "";
    if (genericSuffixes.includes(lastWord) && unique.size <= 2) score -= 1;

    // Slight penalty for very long names
    if (name.length > 60) score -= 1;

    return score;
  }

  function pickBestName(candidates, allText) {
    let best = "";
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (!c || !c.name) continue;
      const s = scoreName(c.name, allText, c.source);
      if (s > bestScore) {
        bestScore = s;
        best = c.name;
      }
    }
    return best;
  }

  function cleanTitle(raw) {
    return raw.replace(/\s*[-|—].*$/g, "").trim();
  }

  function normalizeAddress(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  }

  function getSchemaTypes(item) {
    const t = item["@type"];
    if (!t) return [];
    return Array.isArray(t) ? t.map(String) : [String(t)];
  }

  function isOfferLike(types) {
    return types.some(function(t) { return t === "Offer" || t === "Service"; });
  }

  function isOfferContainer(types) {
    return types.some(function(t) { return t === "OfferCatalog" || t === "AggregateOffer"; });
  }

  function extractTextOffers(item, target) {
    if (!item || typeof item !== "object") return;
    const types = getSchemaTypes(item);
    if (isOfferContainer(types)) {
      // Containers only group leaf offers; recurse without collecting the container itself.
      for (const key of ["itemListElement", "offers", "hasOfferCatalog", "makesOffer"]) {
        const child = item[key];
        if (!child) continue;
        if (Array.isArray(child)) {
          for (const c of child) extractTextOffers(c, target);
        } else {
          extractTextOffers(child, target);
        }
      }
      return;
    }
    if (isOfferLike(types)) {
      let name = "";
      let description = "";
      if (item.itemOffered && typeof item.itemOffered === "object") {
        name = item.itemOffered.name || "";
        description = item.itemOffered.description || "";
      }
      if (!name) name = item.name || "";
      if (!description) description = item.description || "";
      if (name && typeof name === "string") {
        target.push({ name: name.trim(), description: (description || "").trim().slice(0, 400) });
      }
    }
    // Recurse into common nested keys in case items are wrapped.
    for (const key of ["itemOffered", "itemListElement", "hasOfferCatalog", "offers", "makesOffer"]) {
      const child = item[key];
      if (!child) continue;
      if (Array.isArray(child)) {
        for (const c of child) extractTextOffers(c, target);
      } else {
        extractTextOffers(child, target);
      }
    }
  }

  const rawTitle = document.title;
  const title = cleanTitle(rawTitle);

  const nameCandidates = [];
  const jsonldAddresses = [];
  const jsonldOfferings = [];

  // 1. Schema.org structured data is the canonical source for business identity.
  document.querySelectorAll('script[type="application/ld+json"]').forEach(function(el) {
    try {
      const raw = (el.textContent || "").replace(/[\n\r\t]/g, " ");
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        extractTextOffers(item, jsonldOfferings);
        const type = (item["@type"] || "").toLowerCase();
        if (type.includes("organization") || type.includes("localbusiness") || type.includes("website") || type.includes("place") || type.includes("gym") || type.includes("exercise") || type.includes("business")) {
          if (item.name && typeof item.name === "string") nameCandidates.push({ name: item.name.trim(), source: "jsonld" });
          // Some gyms nest the business under "mainEntityOfPage" or a parent org
          if (item.parentOrganization?.name && typeof item.parentOrganization.name === "string") {
            nameCandidates.push({ name: item.parentOrganization.name.trim(), source: "jsonld" });
          }
          // Extract authoritative address from structured data when available.
          const rawAddress = item.address;
          if (rawAddress && typeof rawAddress === "object") {
            const street = (rawAddress.streetAddress || "").trim();
            const city = (rawAddress.addressLocality || "").trim();
            const state = (rawAddress.addressRegion || "").trim();
            const zip = (rawAddress.postalCode || "").trim();
            const country = (rawAddress.addressCountry || "").trim();
            const cityState = [city, state].filter(Boolean).join(", ");
            const addressLine = [street, cityState, zip, country].filter(Boolean).join(" ");
            if (addressLine.length >= 10) jsonldAddresses.push(addressLine);
          }
        }
      }
    } catch (e) {}
  });

  // 2. Open Graph site name is usually editorially set.
  const ogSiteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content');
  if (ogSiteName) nameCandidates.push({ name: cleanTitle(ogSiteName.trim()), source: "og" });

  // 3. Logo/brand image alt text.
  const logoSelectors = [
    'a[href="/"] img[alt]',
    'a[href="./"] img[alt]',
    'header img[alt]',
    'nav img[alt]',
    '.logo img[alt]',
    '.brand img[alt]',
    '.navbar img[alt]',
    '[class*="logo"] img[alt]',
    '[class*="brand"] img[alt]',
    'footer img[alt]',
    'img[alt*="logo" i]',
    'img[alt]',
  ];
  const seenAlts = new Set();
  for (const sel of logoSelectors) {
    for (const img of Array.from(document.querySelectorAll(sel)).slice(0, 5)) {
      const alt = (img.getAttribute('alt') || '').trim();
      if (!alt || alt.length < 3 || alt.length > 80) continue;
      if (/\b(image|photo|picture|icon|svg|banner|hero|background)\b/i.test(alt)) continue;
      if (!seenAlts.has(alt.toLowerCase())) {
        seenAlts.add(alt.toLowerCase());
        nameCandidates.push({ name: alt, source: "logo" });
      }
    }
  }

  // 4. Domain-derived name.
  const domainName = nameFromDomain();
  if (domainName) nameCandidates.push({ name: domainName, source: "domain" });

  // 5. Title is last because it is often SEO-optimized and may not match the real brand name.
  nameCandidates.push({ name: title, source: "title" });

  const visibleText = [rawTitle, ...headings, ...paragraphs].join(" ").toLowerCase();
  const businessName = pickBestName(nameCandidates, visibleText) || title || headings[0] || "";
  const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
  const tagline = metaDescription || ogDescription || paragraphs[0] || "";

  function isInsideHomeLink(img) {
    let node = img.parentElement;
    while (node && node !== document.body) {
      if (node.tagName === "A") {
        const href = (node.getAttribute("href") || "").trim();
        if (href === "/" || href === "./") return true;
        try {
          const url = new URL(href, window.location.href);
          if (url.pathname === "/" && url.hostname === window.location.hostname) return true;
        } catch (e) {}
      }
      node = node.parentElement;
    }
    return false;
  }

  function scoreLogoCandidate(img, rect, src) {
    let score = 0;
    const alt = (img.alt || "").toLowerCase();
    const className = (img.className || "").toString().toLowerCase();
    const parent = img.parentElement;
    const parentClass = parent ? (parent.className || "").toString().toLowerCase() : "";
    const fileName = (src || "").split("?")[0].split("/").pop().toLowerCase();

    if (isInsideHomeLink(img)) score += 100;
    if (className.includes("logo") || parentClass.includes("logo")) score += 60;
    if (alt.includes("logo")) score += 50;
    if (className.includes("brand") || parentClass.includes("brand")) score += 40;

    // Prefer the primary logo file and avoid secondary/slogan variants.
    if (fileName.includes("primary")) score += 50;
    if (fileName.includes("logo")) score += 20;
    if (fileName.includes("secondary")) score -= 100;
    if (fileName.includes("logosecondary")) score -= 150;

    if (rect.width >= 60 && rect.width <= 400 && rect.height >= 20 && rect.height <= 200) score += 20;
    if (rect.top < 150) score += 20;

    // A real logo is small; reject large photos even if their filename/class hints at logo.
    if (rect.width > 500 || rect.height > 300 || rect.width * rect.height > 120000) {
      score -= 300;
    }

    const ratio = rect.width / rect.height;
    if (ratio > 4 || ratio < 0.25) score -= 40;

    if (alt.includes("icon") || alt.includes("arrow") || alt.includes("menu") || alt.includes("hamburger") || alt.includes("close")) score -= 80;
    if (className.includes("icon") || className.includes("avatar")) score -= 50;
    if (className.includes("invisible") || img.style.display === "none" || img.style.visibility === "hidden" || rect.width === 0 || rect.height === 0) score -= 100;

    return score;
  }

  const imageCandidates = Array.from(document.querySelectorAll("img")).map(function(img) {
    const rect = img.getBoundingClientRect();
    return { img: img, rect: rect, src: img.currentSrc || img.src, alt: img.alt || "" };
  });

  let bestLogo = null;
  let bestLogoScore = -Infinity;
  for (const candidate of imageCandidates) {
    if (candidate.rect.width < 60 || candidate.rect.height < 20) continue;
    const score = scoreLogoCandidate(candidate.img, candidate.rect, candidate.src);
    if (score > bestLogoScore) {
      bestLogoScore = score;
      bestLogo = candidate;
    }
  }
  const logoSrc = bestLogo && bestLogoScore > 0 ? bestLogo.src : null;

  function extractBgUrl(style) {
    const image = style.backgroundImage;
    if (!image || image === "none") return null;
    // Match quoted or unquoted url(...) values. Quoted values may contain
    // parentheses (e.g. "Frame%20(1).svg"); unquoted values stop at the first
    // closing paren as required by valid CSS.
    const m = image.match(/url\(\s*(["']?)(.*?)\1\s*\)/);
    return m ? m[2] : null;
  }

  const seenImageSrcs = new Set();
  const bgCandidates = [];
  for (const el of Array.from(document.querySelectorAll("section, div, article, header, footer"))) {
    const style = window.getComputedStyle(el);
    const bgUrl = extractBgUrl(style);
    if (!bgUrl || bgUrl.indexOf("data:") === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) continue;
    const isHero = rect.width >= window.innerWidth * 0.8 && rect.top < window.innerHeight * 0.6;
    bgCandidates.push({ img: null, rect: rect, src: bgUrl, alt: "", context: isHero ? "hero" : "background" });
  }

  const isSvgUrl = function(url) { return /\.svg(?:\?|$)/i.test(url || ""); };

  const images = imageCandidates
    .concat(bgCandidates)
    .filter(function(item) {
      const rect = item.rect;
      const isLogo = logoSrc && item.src === logoSrc;
      // Always keep SVGs/icons regardless of rendered size: they are vector and
      // are frequently used as small section icons (20x20) that would otherwise
      // be discarded. Photos must still meet the minimum size threshold.
      const isVectorIcon = isSvgUrl(item.src);
      return isLogo || isVectorIcon || (rect.width >= 100 && rect.height >= 100);
    })
    .filter(function(item) {
      if (seenImageSrcs.has(item.src)) return false;
      seenImageSrcs.add(item.src);
      return true;
    })
    .slice(0, 40)
    .map(function(item) {
      const rect = item.rect;
      const src = item.src;
      const alt = item.alt || "";
      let context = item.context || "other";
      if (logoSrc && src === logoSrc) context = "logo";
      else if (isSvgUrl(src)) context = "icon";
      else if (rect.width >= window.innerWidth * 0.8 && rect.top < window.innerHeight * 0.6) context = "hero";
      else if (alt.toLowerCase().includes("team") || alt.toLowerCase().includes("coach")) context = "team";
      else if (alt.toLowerCase().includes("testimonial")) context = "testimonial";
      else if (rect.width / rect.height > 2.5 || rect.height / rect.width > 2.5) context = "background";
      return { url: src, alt: alt, context: context, promptKeywords: alt ? alt.split(" ").slice(0, 5) : undefined };
    });

  const grids = [];
  const layoutContainers = document.querySelectorAll("section, div, article, ul, ol, [class*='grid'], [class*='cards'], [class*='list'], [class*='row']");
  for (const el of Array.from(layoutContainers).slice(0, 100)) {
    const style = window.getComputedStyle(el);
    let columns = 0;
    if (style.display === "grid") {
      const tracks = style.gridTemplateColumns.split(" ").filter(function(t) { return t.trim().length > 0; });
      columns = tracks.length;
    } else if (style.display === "flex" && (style.flexDirection === "row" || style.flexDirection === "row-reverse")) {
      const children = Array.from(el.children).filter(function(c) {
        return c.getBoundingClientRect().width > 50;
      });
      if (children.length >= 2) {
        const firstRowTop = children[0]?.getBoundingClientRect().top ?? 0;
        columns = children.filter(function(c) {
          return Math.abs(c.getBoundingClientRect().top - firstRowTop) < 20;
        }).length;
      }
    }
    if (columns >= 2 && columns <= 6) {
      grids.push({ columns: columns, element: el.tagName.toLowerCase(), className: (el.className || "").toString().slice(0, 40) });
    }
  }

  const distinctiveComponents = [];
  const verticalEls = document.querySelectorAll("[style*='writing-mode'], [style*='rotate'], [class*='vertical']");
  for (const el of Array.from(verticalEls).slice(0, 5)) {
    const text = (el.textContent || "").trim().slice(0, 40);
    if (text.length > 2) distinctiveComponents.push({ type: "vertical-text", label: text });
  }

  const stepEls = document.querySelectorAll("[class*='step'], [class*='process'], [class*='how-it-works']");
  const stepCount = new Set(Array.from(stepEls).map((el) => (el.textContent || "").trim().slice(0, 60))).size;
  if (stepCount >= 2) distinctiveComponents.push({ type: "step-section", label: stepCount + "-step process section" });

  const faqs = [];
  const faqItems = document.querySelectorAll("[class*='faq'], [class*='accordion'], details");
  for (const item of Array.from(faqItems).slice(0, 10)) {
    const question = (item.querySelector("h3, h4, summary, [class*='question']")?.textContent || "").trim();
    const answer = (item.querySelector("p, [class*='answer'], [class*='content']")?.textContent || "").trim();
    if (question && answer && question.endsWith("?")) {
      faqs.push({ question: question, answer: answer.slice(0, 300) });
    }
  }

  let offerings = [];
  function isInsideTeamSection(el) {
    let node = el;
    while (node && node !== document.body) {
      const cls = (node.className || "").toString().toLowerCase();
      if (cls.includes("team") || cls.includes("coach") || cls.includes("trainer") || cls.includes("staff")) return true;
      node = node.parentElement;
    }
    return false;
  }

  function looksLikePersonName(text) {
    const parts = text.split(/\s+/).filter(Boolean);
    return parts.length >= 2 && parts.length <= 4 && parts.every((p) => p.length >= 2 && p[0] === p[0].toUpperCase());
  }

  function looksLikeTestimonialQuote(text) {
    const lower = text.toLowerCase();
    const firstPerson = /\b(i|me|my|myself|we|us|our)\b/i.test(text);
    return firstPerson && (lower.includes("fun") || lower.includes("love") || lower.includes("place") || lower.includes("community") || lower.includes("amazing") || text.length > 80);
  }

  const offeringSelectors = [
    "[class*='program']", "[class*='service']", "[class*='offering']",
    "[class*='membership']", "[class*='plan']", "[class*='price']",
    "[class*='class']", "[class*='course']",
  ];
  const seenOfferingNames = new Set();
  for (const sel of offeringSelectors) {
    const cards = document.querySelectorAll(sel);
    for (const card of Array.from(cards).slice(0, 8)) {
      if (isInsideTeamSection(card)) continue;
      const titleEl = card.querySelector("h3, h4, h2, .title, [class*='name'], [class*='title']");
      const title = (titleEl?.textContent || "").trim();
      const desc = (card.querySelector("p, [class*='description']")?.textContent || "").trim().slice(0, 200);
      const price = (card.querySelector("[class*='price'], [class*='cost']")?.textContent || "").trim();
      const availability = (card.querySelector("[class*='available'], [class*='location']")?.textContent || "").trim().slice(0, 100);
      if (!title || seenOfferingNames.has(title)) continue;
      if (title.length > 80) continue;
      if (looksLikePersonName(title)) continue;
      if (looksLikeTestimonialQuote(desc) && !price) continue;
      seenOfferingNames.add(title);
      offerings.push({
        name: title,
        description: availability ? desc + " (" + availability + ")" : desc,
        price: price,
      });
    }
  }

  // Prefer JSON-LD offer catalog (authoritative) over heuristically scraped cards.
  if (jsonldOfferings.length > 0) {
    const domDescriptions = {};
    for (const o of offerings) {
      if (o.name) domDescriptions[o.name] = o.description;
    }
    const seen = new Set();
    offerings = [];
    for (const o of jsonldOfferings) {
      if (!o.name || seen.has(o.name)) continue;
      seen.add(o.name);
      offerings.push({
        name: o.name,
        description: o.description || domDescriptions[o.name] || "",
        price: "",
      });
    }
  }

  const locations = [];
  const addressPattern = /\d+\s+[^\n]{3,}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pl|Place|Ct|Court)\b/i;
  // Strict city/state/zip pattern (e.g. "Overland Park, KS 66212").
  const cityStatePattern = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Za-z\s]+\d{5}(-\d{4})?\b/;
  // Loose city/state pattern for text that only mentions city and state without a zip.
  const looseCityStatePattern = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z][a-z]+\b/;
  const seenAddresses = new Set();

  function isInsideNavOrFooter(el) {
    let node = el;
    while (node && node !== document.body) {
      const tag = node.tagName ? node.tagName.toLowerCase() : "";
      const cls = (node.className || "").toString().toLowerCase();
      if (tag === "nav" || tag === "header" || tag === "footer" || cls.includes("menu") || cls.includes("navigation")) return true;
      node = node.parentElement;
    }
    return false;
  }

  function recordLocation(text) {
    const cleaned = text.replace(/\s+/g, " ").replace(/\n+/g, ", ").trim();
    if (!cleaned || cleaned.length < 15 || cleaned.length > 300) return;
    if (!addressPattern.test(cleaned) && !cityStatePattern.test(cleaned) && !looseCityStatePattern.test(cleaned)) return;
    const key = normalizeAddress(cleaned);
    if (seenAddresses.has(key)) return;
    seenAddresses.add(key);
    locations.push({ address: cleaned });
  }

  // First pass: elements that explicitly claim to be addresses.
  const addressElements = document.querySelectorAll("[class*='address'], address, [class*='location'], [itemtype*='PostalAddress'], [itemprop*='address']");
  for (const el of Array.from(addressElements).slice(0, 20)) {
    if (isInsideNavOrFooter(el)) continue;
    recordLocation((el.textContent || "").trim());
  }

  // Second pass: scan paragraphs, list items, and icon-list text for city/state/zip patterns.
  const candidates = document.querySelectorAll("p, li, [class*='list-text'], [class*='icon-list-text'], [class*='address-line']");
  for (const el of Array.from(candidates).slice(0, 80)) {
    if (isInsideNavOrFooter(el)) continue;
    recordLocation((el.textContent || "").trim());
    if (locations.length >= 5) break;
  }

  // Final fallback: walk text nodes if still no locations.
  if (locations.length === 0) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || "").trim();
      if (cityStatePattern.test(text) && text.length < 300) {
        recordLocation(text);
        if (locations.length >= 3) break;
      }
    }
  }

  const team = [];
  const teamCards = document.querySelectorAll("[class*='team'], [class*='coach'], [class*='trainer']");
  for (const card of Array.from(teamCards).slice(0, 6)) {
    const name = (card.querySelector("h3, h4, [class*='name']")?.textContent || "").trim();
    const role = (card.querySelector("[class*='role'], [class*='title']")?.textContent || "").trim();
    const bio = (card.querySelector("p")?.textContent || "").trim();
    if (name) team.push({ name: name, role: role, bio: bio });
  }

  const testimonials = [];
  const quoteEls = document.querySelectorAll("[class*='testimonial'], [class*='quote'], blockquote");
  for (const el of Array.from(quoteEls).slice(0, 6)) {
    const quote = (el.querySelector("p, [class*='quote']")?.textContent || "").trim();
    const author = (el.querySelector("[class*='author'], [class*='name']")?.textContent || "").trim();
    const role = (el.querySelector("[class*='role']")?.textContent || "").trim();
    if (quote) testimonials.push({ quote: quote, author: author, role: role });
  }

  const seenExternal = new Set();
  const externalLinks = [];
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    const href = a.href;
    if (!href || !href.startsWith("http")) continue;
    if (seenExternal.has(href)) continue;
    seenExternal.add(href);
    externalLinks.push(href);
  }

  // Prefer structured-data addresses over plain-text regex matches.
  const finalLocations = [];
  const finalLocationKeys = new Set();
  function addFinalLocation(address) {
    const key = normalizeAddress(address);
    if (!key || finalLocationKeys.has(key)) return;
    finalLocationKeys.add(key);
    finalLocations.push({ address: address });
  }
  for (const address of jsonldAddresses) {
    addFinalLocation(address);
  }
  for (const loc of locations) {
    addFinalLocation(loc.address);
  }

  // Generic section extraction: walk top-level page sections and infer type.
  const sections = extractGenericSections();

  return {
    samples: samples,
    extraColors: extraColors,
    headings: headings,
    paragraphs: paragraphs,
    buttons: buttons,
    navLinks: navLinks,
    businessName: businessName,
    tagline: tagline,
    images: images,
    faqs: faqs,
    offerings: offerings,
    locations: finalLocations,
    team: team,
    testimonials: testimonials,
    grids: grids,
    distinctiveComponents: distinctiveComponents,
    externalLinks: externalLinks,
    sections: sections,
    headerCtaStyle: headerCtaStyle,
  };

  function isContainer(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    return tag === "section" || tag === "article" || tag === "main" || tag === "div";
  }

  function isLikelySectionRoot(el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "section" || tag === "article") return true;
    const cls = (el.className || "").toString().toLowerCase();
    const id = (el.id || "").toLowerCase();
    // Some builders (Webflow) wrap the hero in a <header> tag. Treat it as a
    // section root only when it carries the primary heading.
    if (tag === "header" && (el.querySelector("h1") || /hero/i.test(cls) || /hero/i.test(id))) return true;
    // Explicit, strong section-type hints. Avoid generic wrapper names like
    // "wrapper", "container", "layout", "row", "content" that often group real
    // sections and cause us to miss them.
    const strongHints = ["section", "band", "hero", "feature", "about", "offer", "step", "process", "testimonial", "cta", "contact", "location", "faq", "review", "gallery"];
    if (strongHints.some((h) => cls.includes(h) || id.includes(h))) return true;
    return false;
  }

  function getDirectText(el) {
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent || "";
      else if (node.nodeType === Node.ELEMENT_NODE && ["P", "SPAN", "STRONG", "EM", "BR"].indexOf(node.tagName) !== -1) {
        text += node.textContent || "";
      }
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function findHeading(el) {
    const h = el.querySelector("h1, h2, h3");
    return h ? (h.textContent || "").trim() : "";
  }

  function findBody(el, heading) {
    const ps = Array.from(el.querySelectorAll("p")).filter(function(p) {
      const t = (p.textContent || "").trim();
      return t.length > 20 && t !== heading;
    });
    return ps.map(function(p) { return (p.textContent || "").trim(); }).join("\n\n").slice(0, 600);
  }

  function findButton(el) {
    const b = el.querySelector("a[class*='button'], a[class*='btn'], button, a[class*='cta']");
    return b ? { label: (b.textContent || "").trim(), href: b.getAttribute("href") || "#" } : null;
  }

  function findHeroButton(el) {
    // The hero CTA should be scoped to the hero section, never a header/nav CTA.
    // Look for a button/cta class first; fall back to the first link that looks
    // like a CTA if no explicit class is found.
    let b = el.querySelector("a[class*='cta'], a[class*='button'], a[class*='btn']");
    if (!b) {
      const links = Array.from(el.querySelectorAll("a")).filter(function(a) {
        const href = a.getAttribute("href") || "";
        const text = (a.textContent || "").trim();
        return text.length > 0 && text.length < 60 && !href.startsWith("tel:") && !href.startsWith("mailto:");
      });
      b = links[0];
    }
    return b ? { label: (b.textContent || "").trim(), href: b.getAttribute("href") || "#" } : null;
  }

  function findSectionImages(el) {
    const out = [];
    const seen = new Set();
    for (const img of Array.from(el.querySelectorAll("img"))) {
      const src = img.currentSrc || img.src;
      if (!src || seen.has(src)) continue;
      const rect = img.getBoundingClientRect();
      const isSvg = /\.svg([?#].*)?$/i.test(src);
      // Skip tiny decorative bitmaps inside sections; keep small SVG icons and
      // any image that is a clear background hero.
      if (rect.width < 40 && rect.height < 40 && !isSvg) continue;
      seen.add(src);
      out.push({ url: src, alt: img.alt || "", context: isSvg ? "icon" : "section" });
    }
    for (const node of Array.from(el.querySelectorAll("*"))) {
      const style = window.getComputedStyle(node);
      const bg = extractBgUrl(style);
      if (bg && !seen.has(bg) && bg.indexOf("data:") !== 0) {
        seen.add(bg);
        out.push({ url: bg, alt: "", context: "background" });
      }
    }
    return out.slice(0, 6);
  }

  function findFAQItems(el) {
    const out = [];
    const seen = new Set();
    const toggles = el.querySelectorAll("[data-click='faq'], .dropdown-primary, details, [class*='faq-item']");
    for (const toggle of Array.from(toggles)) {
      const parent = toggle.closest(".dropdown-primary") || toggle;
      const questionEl = parent.querySelector(".dropdown-heading, summary, [class*='question'], h3, h4");
      const question = (questionEl?.textContent || "").trim();
      // Answers live in a sibling body container, not inside the toggle.
      const answerEl = parent.querySelector(".dp-body p, .dp-content p, [class*='answer'] p, details > :not(summary) p");
      const answer = (answerEl?.textContent || "").trim();
      if (!question || !answer || answer === question) continue;
      if (seen.has(question)) continue;
      seen.add(question);
      out.push({ title: question, description: answer.slice(0, 500) });
    }
    return out.slice(0, 12);
  }

  function inferSectionType(el, heading, body, imgs, hasButton) {
    const cls = (el.className || "").toString().toLowerCase();
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    const text = (el.textContent || "").toLowerCase();

    // Hero: first section, large heading, CTA, full-bleed background.
    const rect = el.getBoundingClientRect();
    const isFirst = !el.previousElementSibling || rect.top < window.innerHeight * 0.5;
    const h1 = el.querySelector("h1");
    if (isFirst && h1 && hasButton && (imgs.some(function(i) { return i.context === "background"; }) || rect.height >= window.innerHeight * 0.5)) {
      return "Hero";
    }

    // FAQ
    if (cls.includes("faq") || cls.includes("accordion") || el.querySelector("details")) return "SiteFAQ";

    // Reviews
    if (cls.includes("testimonial") || cls.includes("review") || el.querySelector("blockquote")) return "SiteReviews";

    // Location: class hints or address patterns in heading/body.
    const locationBody = (heading || "") + "\n" + (body || "");
    if (cls.includes("location") || cls.includes("visit") || cls.includes("address") || cityStatePattern.test(locationBody) || looseCityStatePattern.test(locationBody) || addressPattern.test(locationBody)) return "SiteLocation";

    // CTA: standalone heading + button, little body. Check before steps so a
    // punchy CTA heading like "The hardest step is always the first step."
    // doesn't get classified as a steps section.
    const ctaHeadingPattern = /\b(join|start|get|claim|book|schedule|free|today|now)\b/i;
    if (hasButton && (!body || body.length < 200) && (!imgs.length || imgs.length <= 1)) {
      if (!heading || heading.length < 120 || ctaHeadingPattern.test(heading)) return "SiteCTA";
    }

    // Steps: explicit class/text hints, heading keywords, or numbered/sequential cards.
    const stepHeadingPattern = /\b(getting started|how it works|our process|the process|step[s]?\b|easy|start today|join today|become a member)\b/i;
    if (cls.includes("step") || cls.includes("process") || /step\s*\d/i.test(text) || stepHeadingPattern.test(heading || "")) {
      return "SiteSteps";
    }
    const cards = findCards(el, heading);
    const isSequentialCards =
      cards.length >= 3 &&
      cards.length <= 5 &&
      cards.filter((c) => /^\s*(\d+|one|two|three|four|five|first|second|third)/i.test(c.title || "")).length >= cards.length * 0.5;
    if (isSequentialCards) return "SiteSteps";

    // Card group: multiple titled items (reuse cards already inspected for steps).
    if (cards.length >= 2) return "SiteCardGroup";

    // Image gallery: mostly images.
    if (imgs.length >= 4 && (!heading || body.length < 100)) return "SiteImageGallery";

    // Default to text.
    return "Text";
  }

  function getDepth(ancestor, descendant) {
    let depth = 0;
    let node = descendant;
    while (node && node !== ancestor) {
      node = node.parentElement;
      depth++;
    }
    return depth;
  }

  function scoreCardContainer(container) {
    const children = Array.from(container.children).filter(function(c) {
      const rect = c.getBoundingClientRect();
      return rect.width > 60 && rect.height > 40;
    });
    let score = 0;
    for (const child of children) {
      const hasHeading = child.querySelector("h2, h3, h4, h5, .title, [class*='title']") !== null;
      const hasDesc = child.querySelector("p, [class*='description']") !== null;
      const hasImg = child.querySelector("img") !== null;
      if (hasHeading) score += 2;
      if (hasDesc) score += 1;
      if (hasImg) score += 1;
    }
    return score;
  }

  function svgToDataUrl(svg) {
    try {
      const serializer = new XMLSerializer();
      let str = serializer.serializeToString(svg);
      if (!str.includes("xmlns=")) str = str.replace("<svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"");
      return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      return null;
    }
  }

  function findCardIcon(child) {
    const svg = child.querySelector(".icon-svg svg, .mb-svg svg, svg");
    if (!svg) return null;
    const viewBox = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number).filter(function(n) { return !isNaN(n); });
    const width = viewBox[2] || parseFloat(svg.getAttribute("width")) || 200;
    if (width > 200) return null;
    return svgToDataUrl(svg);
  }

  function extractCardsFromContainer(container, sectionHeading) {
    const out = [];
    const seenTitles = new Set();
    for (const child of Array.from(container.children)) {
      const rect = child.getBoundingClientRect();
      if (rect.width < 60 || rect.height < 40) continue;
      const titleEl = child.querySelector("h2, h3, h4, h5, .title, [class*='title'], [class*='name']");
      let title = (titleEl?.textContent || "").trim();
      if (!title) {
        const strong = child.querySelector("strong, b");
        title = (strong?.textContent || "").trim();
      }
      if (!title || title.length > 100 || seenTitles.has(title)) continue;
      // The section heading itself sometimes sits inside the same grid as the
      // cards (e.g. a hero card layout). Skip it so it doesn't become a card.
      if (sectionHeading && title.toLowerCase() === sectionHeading.toLowerCase()) continue;
      seenTitles.add(title);
      const desc = (child.querySelector("p, [class*='description'], [class*='summary']")?.textContent || "").trim().slice(0, 300);

      // Collect every image candidate inside the card (photos, SVG icons, and
      // CSS background images), then prefer the largest non-SVG photo. This
      // prevents tiny SVG icons from shadowing full-bleed card photos.
      const candidates = [];
      for (const img of Array.from(child.querySelectorAll("img"))) {
        const src = img.currentSrc || img.src;
        if (src) candidates.push({ src, rect: img.getBoundingClientRect(), isSvg: isSvgUrl(src) });
      }
      const iconSvg = findCardIcon(child);
      if (iconSvg) candidates.push({ src: iconSvg, rect: { width: 40, height: 40 }, isSvg: true });
      for (const node of Array.from(child.querySelectorAll("*[style*='background-image']"))) {
        const bg = extractBgUrl(window.getComputedStyle(node));
        if (bg && bg.indexOf("data:") !== 0) {
          candidates.push({ src: bg, rect: node.getBoundingClientRect(), isSvg: isSvgUrl(bg) });
        }
      }
      let best = null;
      let bestScore = -1;
      for (const cand of candidates) {
        const area = cand.rect.width * cand.rect.height;
        // Strongly prefer photos; among photos prefer larger area. SVGs only win
        // when there are no photos at all.
        const score = cand.isSvg ? Math.max(0, area - 1000) : area + 100000;
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      const imgUrl = best ? best.src : undefined;

      out.push({ title: title, description: desc || undefined, imageUrl: imgUrl });
    }
    return out;
  }

  function findCards(el, sectionHeading) {
    // Cards are rarely direct children of a section; they live inside a grid,
    // flex row, or list container. Find the highest-scoring layout container
    // inside the section whose children look like cards.
    const candidates = Array.from(el.querySelectorAll("*")).filter(function(node) {
      if (node === el) return false;
      const style = window.getComputedStyle(node);
      const display = style.display;
      const isLayout = display === "grid" || display === "flex" || display === "inline-flex" || node.tagName === "UL" || node.tagName === "OL";
      if (!isLayout) return false;
      const kids = Array.from(node.children).filter(function(c) {
        const rect = c.getBoundingClientRect();
        return rect.width > 60 && rect.height > 40;
      });
      return kids.length >= 2;
    });
    candidates.sort(function(a, b) {
      const scoreA = scoreCardContainer(a);
      const scoreB = scoreCardContainer(b);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return getDepth(el, a) - getDepth(el, b);
    });
    for (const container of candidates) {
      const cards = extractCardsFromContainer(container, sectionHeading);
      if (cards.length >= 2) return cards;
    }
    return [];
  }

  function detectTheme(el) {
    const style = window.getComputedStyle(el);
    const bg = style.backgroundColor;
    const hex = colorToHex(bg);
    if (!hex) return undefined;
    const clean = hex.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map(function(c) { return c + c; }).join("") : clean;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum < 0.5 ? "dark" : "light";
  }

  function detectColumns(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "grid") {
      const tracks = style.gridTemplateColumns.split(" ").filter(function(t) { return t.trim().length > 0; });
      return tracks.length;
    }
    const children = Array.from(el.children).filter(function(c) { return c.getBoundingClientRect().width > 50; });
    if (children.length < 2) return 1;
    const tops = children.map(function(c) { return c.getBoundingClientRect().top; });
    const firstRowTop = tops[0];
    return tops.filter(function(t) { return Math.abs(t - firstRowTop) < 20; }).length;
  }

  function detectHeroAlign(el) {
    const h1 = el.querySelector("h1");
    if (!h1) return "center";
    const style = window.getComputedStyle(h1);
    const textAlign = style.textAlign;
    if (textAlign === "left" || textAlign === "start") return "left";
    if (textAlign === "right" || textAlign === "end") return "right";
    const wrap = el.querySelector(".content, .hero-content, .text-wrapper, [class*='align-left']");
    if (wrap && String(wrap.className || "").toLowerCase().includes("left")) return "left";
    return "center";
  }

  function detectHeroEyebrow(el) {
    const h1 = el.querySelector("h1");
    if (!h1) return undefined;

    const candidates = Array.from(el.querySelectorAll("p, span, div, h2, h3, h4")).filter(function(node) {
      const text = (node.textContent || "").trim();
      if (!text || text.length < 3 || text.length > 80) return false;
      if (text === (h1.textContent || "").trim()) return false;
      return !!(node.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING);
    });

    if (candidates.length === 0) return undefined;

    let best = null;
    let bestScore = -Infinity;
    for (const cand of candidates) {
      const style = window.getComputedStyle(cand);
      const bg = style.backgroundColor;
      const hasDistinctBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      const rect = cand.getBoundingClientRect();
      const h1Rect = h1.getBoundingClientRect();
      const distance = h1Rect.top - rect.bottom;
      const score = (hasDistinctBg ? 1000 : 0) - distance;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }

    if (!best) return undefined;
    const bestStyle = window.getComputedStyle(best);
    const text = (best.textContent || "").trim();
    if (!text) return undefined;

    return {
      text,
      bg: rgbToHex(bestStyle.backgroundColor),
      color: rgbToHex(bestStyle.color),
      padding: bestStyle.padding,
    };
  }

  function detectHeroUppercase(el) {
    const h1 = el.querySelector("h1");
    if (!h1) return true;
    const style = window.getComputedStyle(h1);
    const transform = (style.textTransform || "").toLowerCase();
    if (transform === "uppercase") return true;
    if (transform === "none" || transform === "capitalize") return false;
    return true;
  }

  function detectHeroTextColor(el) {
    const h1 = el.querySelector("h1");
    if (!h1) return undefined;
    const color = rgbToHex(window.getComputedStyle(h1).color);
    return color || undefined;
  }

  function detectSubtitleUppercase(el, heading) {
    const ps = Array.from(el.querySelectorAll("p")).filter(function(p) {
      const t = (p.textContent || "").trim();
      return t.length > 20 && t !== heading;
    });
    const first = ps[0];
    if (!first) return undefined;
    const transform = (window.getComputedStyle(first).textTransform || "").toLowerCase();
    return transform === "uppercase";
  }

  function detectHeroCtaColors(el) {
    const btn = el.querySelector("a[class*='button'], a[class*='btn'], a[class*='cta'], button");
    if (!btn) return undefined;
    const style = window.getComputedStyle(btn);
    const bg = rgbToHex(style.backgroundColor);
    const color = rgbToHex(style.color);
    if (!bg || !color) return undefined;
    return { bg, color };
  }

  function detectHeroCtaAppearance(el) {
    const btn = el.querySelector("a[class*='button'], a[class*='btn'], a[class*='cta'], button");
    if (!btn) return undefined;
    const textEl = btn.querySelector("p, span, .text, [class*='text']") || btn;
    const textStyle = window.getComputedStyle(textEl);
    const btnStyle = window.getComputedStyle(btn);
    const bgEl = Array.from(btn.querySelectorAll("*")).find(function(child) {
      const bg = window.getComputedStyle(child).backgroundColor;
      return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    });
    const bgStyle = bgEl ? window.getComputedStyle(bgEl) : btnStyle;
    const hasIcon = !!btn.querySelector("svg, img, i, [class*='arrow'], [class*='chevron'], [class*='icon']");
    const transform = (textStyle.textTransform || "").toLowerCase();
    const weight = parseInt(textStyle.fontWeight || "0", 10);
    return {
      bg: rgbToHex(bgStyle.backgroundColor),
      color: rgbToHex(textStyle.color),
      radius: bgStyle.borderRadius,
      hasIcon,
      uppercase: transform === "uppercase",
      bold: weight >= 700,
      transform: btnStyle.transform,
      padding: btnStyle.padding,
    };
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb === "rgba(0, 0, 0, 0)") return null;
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return null;
    return "#" + m.slice(0, 3).map(function(x) {
      const hex = parseInt(x, 10).toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    }).join("");
  }

  function isDarkColor(hex) {
    if (!hex) return false;
    const clean = hex.replace("#", "");
    const full = clean.length === 3 ? clean.split("").map(function(c) { return c + c; }).join("") : clean;
    const r = parseInt(full.slice(0, 2), 16) || 0;
    const g = parseInt(full.slice(2, 4), 16) || 0;
    const b = parseInt(full.slice(4, 6), 16) || 0;
    return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
  }

  function captureComputedStyleSnapshot(el, selectorName) {
    if (!el) return null;
    const style = window.getComputedStyle(el);
    return {
      selector: selectorName || el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
      tagName: el.tagName,
      className: (el.className || "").toString() || undefined,
      backgroundColor: style.backgroundColor || undefined,
      color: style.color || undefined,
      fontFamily: style.fontFamily || undefined,
      fontSize: style.fontSize || undefined,
      fontWeight: style.fontWeight || undefined,
      textTransform: style.textTransform || undefined,
      textAlign: style.textAlign || undefined,
      lineHeight: style.lineHeight || undefined,
      letterSpacing: style.letterSpacing || undefined,
      borderRadius: style.borderRadius || undefined,
      padding: style.padding || undefined,
      margin: style.margin || undefined,
      boxShadow: style.boxShadow || undefined,
      display: style.display || undefined,
      flexDirection: style.flexDirection || undefined,
      justifyContent: style.justifyContent || undefined,
      alignItems: style.alignItems || undefined,
      gap: style.gap || undefined,
    };
  }

  function sanitizeOuterHTML(el) {
    if (!el || !el.outerHTML) return "";
    let html = el.outerHTML;
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
    html = html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "");
    html = html.replace(/\s+on\w+=\"[^\"]*\"/gi, "");
    html = html.replace(/\s+on\w+='[^']*'/gi, "");
    html = html.replace(/\s+on\w+=[^\s>]+/gi, "");
    html = html.replace(/\s+srcset=\"[^\"]*\"/gi, "");
    html = html.replace(/\s+srcset='[^']*'/gi, "");
    html = html.replace(/\s+style=\"[^\"]*\"/gi, "");
    html = html.replace(/\s+style='[^']*'/gi, "");
    html = html.replace(/\s+/g, " ").trim();
    const MAX = 8192;
    return html.length > MAX ? html.slice(0, MAX) : html;
  }

  function inferSectionLayoutHint(root, computedStyles, images) {
    const style = window.getComputedStyle(root);
    const cls = (root.className || "").toString().toLowerCase();
    const bgImage = style.backgroundImage;
    const hasBackgroundImage = !!(bgImage && bgImage !== "none");
    const hasOverlay = !!root.querySelector("[class*='overlay'], [class*='backdrop']");
    const bg = style.backgroundColor;
    const hex = colorToHex(bg);
    let theme;
    if (hex) {
      const clean = hex.replace("#", "");
      const full = clean.length === 3 ? clean.split("").map(function(c) { return c + c; }).join("") : clean;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      theme = lum < 0.5 ? "dark" : "light";
    }
    const align = detectHeroAlign(root);
    const columns = detectColumns(root);
    let imagePosition = "none";
    if (hasBackgroundImage || images.some(function(i) { return i.context === "background"; })) {
      imagePosition = "background";
    } else if (images.length > 0) {
      imagePosition = "left";
    }
    const hasBorder = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].some(function(w) { return w && w !== "0px"; });
    return { theme: theme, centered: align === "center", columns: columns, imagePosition: imagePosition, align: align, hasBackgroundImage: hasBackgroundImage, hasBorder: hasBorder, hasOverlay: hasOverlay };
  }

  function findFirstCta(root) {
    return root.querySelector("a[class*='button'], a[class*='btn'], a[class*='cta'], button") || null;
  }

  function extractGenericSections() {
    const roots = [];
    const bodyEl = document.body;
    if (!bodyEl) return [];

    // Collect likely section roots, skipping header/footer/nav.
    function collectRoots(el) {
      if (el.tagName === "NAV" || el.tagName === "FOOTER") return;
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return;
      if (isLikelySectionRoot(el)) {
        roots.push(el);
        return;
      }
      for (const child of Array.from(el.children)) {
        collectRoots(child);
      }
    }
    collectRoots(bodyEl);
    console.log("[extract] roots found:", roots.length, roots.map(function(r) { return r.tagName + (r.className ? '.' + String(r.className).split(' ').slice(0,3).join('.') : ''); }).join(', '));

    // If no explicit section roots, fall back to top-level direct children of body/main.
    if (roots.length === 0) {
      for (const child of Array.from(bodyEl.children)) {
        if (["HEADER", "NAV", "FOOTER", "SCRIPT", "STYLE"].indexOf(child.tagName) !== -1) continue;
        roots.push(child);
      }
    }

    const out = [];
    let order = 0;
    for (const root of roots) {
      const rect = root.getBoundingClientRect();
      console.log("[extract] root", root.tagName, String(root.className).split(' ').slice(0,3).join('.'), "height", rect.height);
      if (rect.height < 80) continue; // Skip tiny wrappers.
      const heading = findHeading(root);
      const body = findBody(root, heading);
      let button = findButton(root);
      const images = findSectionImages(root);
      const type = inferSectionType(root, heading, body, images, !!button);
      let items;
      if (type === "SiteCardGroup" || type === "SiteSteps") {
        const cards = findCards(root, heading);
        if (cards.length >= 2) items = cards;
      } else if (type === "SiteFAQ") {
        const faqs = findFAQItems(root);
        if (faqs.length >= 1) items = faqs;
      } else if (type === "Hero") {
        // Make sure the hero CTA is taken from inside the hero section, not from
        // a header or nav CTA elsewhere on the page.
        const heroBtn = findHeroButton(root);
        if (heroBtn) {
          button = heroBtn;
          items = [{ title: heroBtn.label, description: heroBtn.href }];
        }
      }

      const ctaAppearance = detectHeroCtaAppearance(root);
      const eyebrow = detectHeroEyebrow(root);
      const styleHint = {
        theme: detectTheme(root),
        centered: true,
        columns: detectColumns(root),
        imagePosition: images.some(function(i) { return i.context === "background"; }) ? "background" : images.length ? "left" : "none",
        sourceOrder: order,
        align: detectHeroAlign(root),
        eyebrow: eyebrow?.text,
        uppercase: detectHeroUppercase(root),
        subtitleUppercase: detectSubtitleUppercase(root, heading),
        ctaStyle: "primary",
        heroTextColor: detectHeroTextColor(root),
        heroCtaBg: ctaAppearance?.bg,
        heroCtaColor: ctaAppearance?.color,
        heroCtaRadius: ctaAppearance?.radius,
        heroCtaHasIcon: ctaAppearance?.hasIcon,
        heroCtaUppercase: ctaAppearance?.uppercase,
        heroCtaBold: ctaAppearance?.bold,
        heroCtaTransform: ctaAppearance?.transform,
        heroCtaPadding: ctaAppearance?.padding,
        eyebrowBg: eyebrow?.bg,
        eyebrowColor: eyebrow?.color,
        eyebrowPadding: eyebrow?.padding,
      };

      // Build per-section visual evidence for downstream screenshot cropping and doc generation.
      const pageSlug = "index";
      const sectionId = "section-" + order;
      const evidenceId = "section-" + pageSlug + "-" + order;
      const rootRect = root.getBoundingClientRect();
      const computedSnapshots = [];
      computedSnapshots.push(captureComputedStyleSnapshot(root, "root"));
      const firstHeading = root.querySelector("h1, h2, h3");
      if (firstHeading) computedSnapshots.push(captureComputedStyleSnapshot(firstHeading, "heading"));
      const firstParagraph = root.querySelector("p");
      if (firstParagraph) computedSnapshots.push(captureComputedStyleSnapshot(firstParagraph, "paragraph"));
      const firstCta = findFirstCta(root);
      if (firstCta) computedSnapshots.push(captureComputedStyleSnapshot(firstCta, "cta"));
      let firstVisual = root.querySelector("img");
      if (!firstVisual) {
        const bgNode = Array.from(root.querySelectorAll("*")).find(function(n) {
          const s = window.getComputedStyle(n);
          return s.backgroundImage && s.backgroundImage !== "none";
        });
        firstVisual = bgNode || null;
      }
      if (firstVisual) computedSnapshots.push(captureComputedStyleSnapshot(firstVisual, "image"));
      const layoutHint = inferSectionLayoutHint(root, computedSnapshots, images);
      const visualEvidence = {
        evidenceId: evidenceId,
        pageSlug: pageSlug,
        sectionId: sectionId,
        boundingBox: { x: rootRect.x, y: rootRect.y, width: rootRect.width, height: rootRect.height },
        computedStyles: computedSnapshots.filter(function(s) { return s !== null; }),
        domSnippet: sanitizeOuterHTML(root),
        layoutHint: layoutHint,
      };

      // For location sections, find the most specific address line inside the
      // section so the renderer can show a real map address instead of prose.
      let address;
      if (type === "SiteLocation") {
        const addressTexts = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, address"))
          .map(function(node) { return (node.textContent || "").trim(); })
          .filter(function(t) { return t.length >= 15 && t.length <= 200; })
          .filter(function(t) { return addressPattern.test(t) || cityStatePattern.test(t) || looseCityStatePattern.test(t); });
        address = addressTexts[0] || heading || body;
      }

      // Reviews loaded via third-party iframe widgets still need to render.
      let widgetUrl;
      if (type === "SiteReviews") {
        const iframe = root.querySelector("iframe");
        if (iframe && iframe.src && iframe.src.indexOf("http") === 0) {
          widgetUrl = iframe.src;
        }
      }

      // Drop decorative arrow/checkmark icons from step cards so the numbered
      // circle remains the only visual marker (matching most source designs).
      if (type === "SiteSteps" && items) {
        for (const item of items) {
          const url = item.imageUrl || "";
          if (/\.svg([?#].*)?$/i.test(url) && /arrow|down|right|chevron|dropdown|check/i.test(url.toLowerCase())) {
            item.imageUrl = undefined;
          }
        }
      }

      // FAQ sections extract both a plain-text body and accordion items. Keep
      // only the intro text as the body so questions don't render twice.
      let finalBody = body || undefined;
      if (type === "SiteFAQ" && items && items.length > 0) {
        const firstQuestion = items[0].title || "";
        const allText = (root.textContent || "").replace(/\s+/g, " ").trim();
        const qIndex = allText.indexOf(firstQuestion);
        if (qIndex > 0) {
          const intro = allText.slice(0, qIndex).trim();
          const introWithoutHeading = heading ? intro.replace(new RegExp(heading.replace(/[.*+?^\${}()|[\]\\]/g, "\\$&"), "i"), "").trim() : intro;
          finalBody = introWithoutHeading || undefined;
        }
      }

      const section = {
        id: sectionId,
        type: type,
        heading: heading || undefined,
        body: finalBody,
        address: address || undefined,
        widgetUrl: widgetUrl,
        intent: type + " section" + (heading ? ": " + heading : ""),
        cta: button || undefined,
        visualEvidence: visualEvidence,
        items: items,
        images: images.length ? images : undefined,
        styleHint: styleHint,
      };

      // CTA section: attach button info as items so renderer can show it.
      if (type === "SiteCTA" && button) {
        section.items = [{ title: button.label, description: button.href }];
      }

      out.push(section);
      order++;
    }

    return out.slice(0, 15);
  }
})()
`;


async function runBrowserExtraction(page: Page): Promise<BrowserExtractionResult> {
  return page.evaluate(BROWSER_EXTRACTION_SCRIPT as unknown as () => BrowserExtractionResult);
}

function toHex(color: string): string | null {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!match) return null;
  const r = parseInt(match[1]!, 10);
  const g = parseInt(match[2]!, 10);
  const b = parseInt(match[3]!, 10);
  const a = match[4] ? parseFloat(match[4]) : 1;
  if (a < 0.05) return null;
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function rgbFromHex(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

function hslFromRgb(rgb: { r: number; g: number; b: number }): { h: number; s: number; l: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let s = 0;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function colorDistance(a: { r: number; g: number; b: number }, b2: { r: number; g: number; b: number }): number {
  return Math.sqrt(
    Math.pow(a.r - b2.r, 2) + Math.pow(a.g - b2.g, 2) + Math.pow(a.b - b2.b, 2),
  );
}

function uniqueColors(candidates: ColorCandidate[], threshold = 18): ColorCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.count - a.count);
  const result: ColorCandidate[] = [];
  for (const c of sorted) {
    const parsed = rgbFromHex(c.hex);
    if (!parsed) continue;
    const exists = result.some((r) => {
      const rp = rgbFromHex(r.hex);
      return rp && colorDistance(parsed, rp) < threshold;
    });
    if (!exists) result.push(c);
  }
  return result;
}

function detectLuminance(hex: string): number {
  const c = rgbFromHex(hex);
  if (!c) return 0.5;
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

function detectSaturation(hex: string): number {
  const rgb = rgbFromHex(hex);
  if (!rgb) return 0;
  return hslFromRgb(rgb).s;
}

const BROWSER_LINK_COLORS = new Set(["#0000EE", "#0000FF", "#551A8B", "#0000CD"]);

function isBrowserLinkColor(hex: string): boolean {
  return BROWSER_LINK_COLORS.has(hex.toUpperCase());
}

function roleForColor(hex: string, contexts: string[]): ScrapedColor["role"] {
  const lum = detectLuminance(hex);
  const sat = detectSaturation(hex);
  const ctx = contexts.join(" ").toLowerCase();

  // Near-white is always a background first, never a border.
  if (lum > 0.95) return "background";
  // Near-black is always text first.
  if (lum < 0.08) return "text";

  // Grayscale colors are never accents.
  if (sat <= 10) {
    if (ctx.includes("border")) return "border";
    if (lum > 0.85) return "background";
    if (lum < 0.2) return "text";
    return lum > 0.5 ? "textMuted" : "text";
  }

  if (sat > 30 && (ctx.includes("button") || ctx.includes("link") || ctx.includes("cta"))) {
    return "accent";
  }

  if (ctx.includes("button bg") || ctx.includes("button background")) return sat > 15 ? "button" : "border";
  if (ctx.includes("button text")) return sat > 15 ? "buttonText" : "text";
  if (ctx.includes("accent") || ctx.includes("cta")) return "accent";
  if (ctx.includes("border")) return "border";
  if (ctx.includes("background") || ctx.includes("surface")) return lum > 0.5 ? "background" : "surface";
  if (ctx.includes("text")) return lum > 0.5 ? "textMuted" : "text";

  if (sat > 40) return "accent";
  if (lum > 0.85) return "background";
  if (lum < 0.15) return "text";
  return lum > 0.5 ? "textMuted" : "text";
}

function tokenName(role: ScrapedColor["role"], index: number): string {
  const names: Record<ScrapedColor["role"], string> = {
    background: "bg-primary",
    surface: "surface",
    text: "text-primary",
    textMuted: "text-muted",
    accent: "accent",
    border: "border",
    button: "button-fill",
    buttonText: "button-text",
  };
  return index > 0 ? `${names[role]}-${index + 1}` : names[role];
}

function cleanFontFamily(family: string): string {
  return (family.split(",")[0] ?? "")
    .replace(/['"]/g, "")
    .trim();
}

function pxToTailwind(px: number): string {
  if (px >= 96) return "text-6xl";
  if (px >= 72) return "text-5xl";
  if (px >= 60) return "text-4xl";
  if (px >= 48) return "text-3xl";
  if (px >= 36) return "text-2xl";
  if (px >= 30) return "text-xl";
  if (px >= 24) return "text-lg";
  if (px >= 18) return "text-base";
  if (px >= 14) return "text-sm";
  return "text-xs";
}

function buildColors(samples: ComputedStyleSample[], extraColors: { hex: string; context: string; area: number }[] = []): ScrapedColor[] {
  const candidates: Record<string, ColorCandidate & { area: number; saturation: number }> = {};

  function getCandidate(hex: string) {
    if (!candidates[hex]) {
      const rgb = rgbFromHex(hex);
      const hsl = rgb ? hslFromRgb(rgb) : null;
      candidates[hex] = { hex, count: 0, contexts: [], area: 0, saturation: hsl?.s ?? 0 };
    }
    return candidates[hex];
  }

  let bodyBackground: string | null = null;
  let bodyForeground: string | null = null;

  for (const s of samples) {
    const isBodyOrHtml = s.tagName === "BODY" || s.tagName === "HTML";
    const isButton = s.tagName === "BUTTON" || s.className.toLowerCase().includes("button") || s.className.toLowerCase().includes("btn");
    const isLink = s.tagName === "A";
    const isHeading = s.tagName.startsWith("H");
    const bg = toHex(s.backgroundColor);
    const fg = toHex(s.color);
    const bd = toHex(s.borderColor);

    if (isBodyOrHtml) {
      if (bg) bodyBackground = bg;
      if (fg) bodyForeground = fg;
    }

    if (bg) {
      const c = getCandidate(bg);
      c.count += 1;
      c.area += s.area;
      const ctx = isButton ? "button background" : "background";
      if (!c.contexts.includes(ctx)) c.contexts.push(ctx);
    }
    if (fg) {
      const c = getCandidate(fg);
      c.count += 1;
      c.area += s.area;
      const ctx = isButton ? "button text" : isLink ? "link text" : isHeading ? "heading text" : "text";
      if (!c.contexts.includes(ctx)) c.contexts.push(ctx);
    }
    if (bd) {
      const c = getCandidate(bd);
      c.count += 1;
      c.area += s.area;
      if (!c.contexts.includes("border")) c.contexts.push("border");
    }
  }

  for (const c of extraColors) {
    const cand = getCandidate(c.hex);
    cand.count += Math.max(1, Math.log10(c.area + 1));
    cand.area += c.area;
    if (!cand.contexts.includes(c.context)) cand.contexts.push(c.context);
  }

  // Score: saturated colors used on large backgrounds get a strong brand bonus.
  for (const cand of Object.values(candidates)) {
    const ctx = cand.contexts.join(" ");
    if (cand.saturation > 35 && (ctx.includes("button") || ctx.includes("link"))) {
      cand.count += 4;
    }
    if (cand.saturation > 50 && cand.area > 50000 && ctx.includes("background")) {
      cand.count += 6;
    }
  }

  const sorted = Object.values(candidates).sort((a, b) => b.count - a.count);
  const unique = uniqueColors(sorted);

  // Determine the dominant background and foreground from sampled area so dark-mode
  // sites (black body / white text) get the correct roles instead of assuming
  // white is always the background and black is always text.
  const COLOR_MATCH_DISTANCE = 18;
  function matchesColor(hex: string, target: string | null | undefined): boolean {
    if (!target) return false;
    const a = rgbFromHex(hex);
    const b = rgbFromHex(target);
    if (!a || !b) return hex.toUpperCase() === target.toUpperCase();
    return colorDistance(a, b) < COLOR_MATCH_DISTANCE;
  }

  // Prefer the canonical BODY/HTML background/foreground colors when available.
  // Fallback to the largest-area sampled colors only if the body itself is
  // transparent or not captured (e.g. some frameworks use a wrapper div).
  const dominantBg = bodyBackground
    ? { area: Number.MAX_SAFE_INTEGER, hex: bodyBackground, lum: detectLuminance(bodyBackground) }
    : Object.values(candidates).reduce<{ area: number; hex: string; lum: number } | null>((best, c) => {
        const isBgContext = c.contexts.some((ctx) => ctx.includes("background") || ctx.includes("surface"));
        if (!isBgContext) return best;
        if (!best || c.area > best.area) return { area: c.area, hex: c.hex, lum: detectLuminance(c.hex) };
        return best;
      }, null);

  const dominantFg = bodyForeground
    ? { area: Number.MAX_SAFE_INTEGER, hex: bodyForeground, lum: detectLuminance(bodyForeground) }
    : Object.values(candidates).reduce<{ area: number; hex: string; lum: number } | null>((best, c) => {
        const isTextContext = c.contexts.some((ctx) => ctx.includes("text"));
        if (!isTextContext) return best;
        const lum = detectLuminance(c.hex);
        const bgLum = dominantBg?.lum ?? 0.5;
        const contrast = Math.abs(lum - bgLum);
        if (contrast < 0.25) return best; // skip colors too close to the background
        if (!best || c.area > best.area) return { area: c.area, hex: c.hex, lum };
        return best;
      }, null);

  // Assign roles. First pass: pick the strongest saturated color as the primary accent,
  // but never promote browser default link colors to brand accents.
  const accentIndex = unique.findIndex((u) => {
    if (isBrowserLinkColor(u.hex)) return false;
    const c = candidates[u.hex];
    if (!c) return false;
    return c.saturation > 40 && (c.contexts.includes("background") || c.contexts.includes("button background") || c.contexts.includes("link text"));
  });
  if (accentIndex > 0) {
    const accent = unique.splice(accentIndex, 1)[0];
    if (accent) unique.unshift(accent);
  }

  const colors: ScrapedColor[] = [];
  let accentCount = 0;
  for (const u of unique.slice(0, 10)) {
    let role: ScrapedColor["role"];
    if (matchesColor(u.hex, dominantBg?.hex)) {
      role = "background";
    } else if (matchesColor(u.hex, dominantFg?.hex)) {
      role = "text";
    } else {
      role = roleForColor(u.hex, u.contexts);
      if (role === "accent" && isBrowserLinkColor(u.hex)) {
        role = detectLuminance(u.hex) > 0.5 ? "textMuted" : "text";
      }
    }
    let token = tokenName(role, colors.filter((c) => c.role === role).length);
    // Brand-specific naming: the first saturated accent becomes brand-primary.
    if (role === "accent" && accentCount === 0) {
      token = "brand-primary";
      accentCount++;
    } else if (role === "accent" && accentCount === 1) {
      token = "brand-secondary";
      accentCount++;
    } else if (role === "accent") {
      accentCount++;
    }
    colors.push({
      token,
      hex: u.hex,
      role,
      usage: u.contexts.slice(0, 2).join(", "),
    });
  }

  // Dedupe near-identical dark text colors so we don't emit text-primary and text-primary-2 for #000000 vs #1D1D1D.
  const keptText: ScrapedColor[] = [];
  const TEXT_DEDUPE_DISTANCE = 45;
  for (const c of colors) {
    if (c.role !== "text") {
      keptText.push(c);
      continue;
    }
    const rgb = rgbFromHex(c.hex);
    const isDuplicate = rgb && keptText.some((k) => {
      if (k.role !== "text") return false;
      const kRgb = rgbFromHex(k.hex);
      return kRgb && colorDistance(rgb, kRgb) < TEXT_DEDUPE_DISTANCE;
    });
    if (!isDuplicate) keptText.push(c);
  }
  // Re-number text tokens after dedupe.
  const finalColors = keptText.map((c) => {
    if (c.role === "text") {
      const textIndex = keptText.filter((k, i) => k.role === "text" && i < keptText.indexOf(c)).length;
      return { ...c, token: textIndex > 0 ? `text-primary-${textIndex + 1}` : "text-primary" };
    }
    return c;
  });

  const hasBackground = finalColors.some((c) => c.role === "background");
  const hasText = finalColors.some((c) => c.role === "text");
  if (!hasBackground) finalColors.unshift({ token: "bg-primary", hex: "#FFFFFF", role: "background", usage: "Page background" });
  if (!hasText) finalColors.unshift({ token: "text-primary", hex: "#111111", role: "text", usage: "Primary text" });

  return finalColors;
}

function buildFonts(samples: ComputedStyleSample[]): ScrapedFont[] {
  const byFamily: Record<string, { family: string; weights: Set<number>; roles: Set<string> }> = {};
  for (const s of samples) {
    const family = cleanFontFamily(s.fontFamily);
    if (!family || family === "inherit" || family === "initial") continue;
    if (!byFamily[family]) byFamily[family] = { family, weights: new Set(), roles: new Set() };
    const weight = parseInt(s.fontWeight, 10);
    if (!isNaN(weight)) byFamily[family].weights.add(weight);
    if (s.tagName === "H1" || s.tagName === "H2" || s.tagName === "H3") byFamily[family].roles.add("heading");
    else if (s.tagName === "BUTTON") byFamily[family].roles.add("button");
    else if (s.tagName === "P" || s.tagName === "BODY") byFamily[family].roles.add("body");
    else if (s.tagName === "A" || s.tagName === "NAV") byFamily[family].roles.add("nav");
  }

  return Object.values(byFamily)
    .slice(0, 5)
    .map((f) => {
      const roles = Array.from(f.roles);
      const role =
        roles.find((r) => r === "heading") ||
        roles.find((r) => r === "body") ||
        roles.find((r) => r === "button") ||
        roles.find((r) => r === "nav") ||
        "body";
      return {
        family: f.family,
        role: role as ScrapedFont["role"],
        weights: Array.from(f.weights).sort((a, b) => a - b),
        usage: roles.length > 1 ? `Used for ${roles.join(", ")}` : `Primary ${role} font`,
      };
    });
}

function buildTypeScale(samples: ComputedStyleSample[]): ScrapedTextStyle[] {
  const semanticMap: Record<string, { label: string; notes?: string }> = {
    h1: { label: "Hero heading", notes: "Bold display headline" },
    h2: { label: "Section heading", notes: "Bold, high emphasis" },
    h3: { label: "Subsection heading", notes: "Medium emphasis" },
    h4: { label: "Card heading", notes: "Compact heading" },
    body: { label: "Body text", notes: "Light-to-regular weight for legibility" },
    button: { label: "Button text", notes: "Uppercase for primary CTAs" },
    small: { label: "Caption/metadata", notes: "Small helper text" },
  };
  const elements = Object.keys(semanticMap);
  const scale: ScrapedTextStyle[] = [];
  for (const el of elements) {
    const matches = samples.filter((s) => s.tagName.toLowerCase() === el || (el === "body" && s.tagName === "P"));
    if (matches.length === 0) continue;
    const sizes = matches.map((s) => s.fontSize).filter((v) => v && v !== "0px");
    const common = mostCommon(sizes);
    const avgPx =
      common != null
        ? parseFloat(common)
        : matches.map((s) => parseFloat(s.fontSize)).filter((n) => !isNaN(n)).reduce((a, b) => a + b, 0) /
          (matches.length || 1);
    const baseToken = pxToTailwind(Math.round(avgPx));
    const { label, notes } = semanticMap[el] ?? { label: el };
    const hasUppercase = matches.some((s) => (s.textTransform || "").toLowerCase() === "uppercase");
    const finalNotes = hasUppercase ? `${notes}, text-transform uppercase` : notes;
    scale.push({
      element: label,
      mobile: baseToken,
      tablet: bumpTailwind(baseToken),
      desktop: bumpTailwind(bumpTailwind(baseToken)),
      notes: finalNotes,
    });
  }
  return scale;
}

function bumpTailwind(token: string): string {
  const order = [
    "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl",
    "text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl",
  ];
  const idx = order.indexOf(token);
  if (idx >= 0 && idx < order.length - 1) return order[idx + 1] ?? token;
  return token;
}

function isUniformRadius(value: string): boolean {
  if (!value || value === "0px") return false;
  const parts = value.split(" ").filter((p) => p !== "/");
  if (parts.length === 0) return false;
  const first = parts[0];
  if (first === "0px") return false;
  // Single value is uniform; otherwise all four corners must match.
  if (parts.length === 1) return true;
  return parts.slice(0, 4).every((p) => p === first);
}

function buildDesignTokens(
  samples: ComputedStyleSample[],
  grids: { columns: number; element: string; className: string }[] = [],
  distinctiveComponents: { type: string; label: string }[] = [],
): ScrapedDesignToken[] {
  const tokens: ScrapedDesignToken[] = [];

  const columnCounts: Record<number, number> = {};
  for (const g of grids) {
    columnCounts[g.columns] = (columnCounts[g.columns] ?? 0) + 1;
  }
  const sortedColumns = Object.entries(columnCounts).sort((a, b) => b[1] - a[1]);
  const topColumn = sortedColumns.find(([count]) => parseInt(count ?? "0", 10) >= 2);
  if (topColumn) {
    const columns = parseInt(topColumn[0] ?? "0", 10);
    tokens.push({
      category: "grid",
      value: `${columns}-column grid`,
      usage: "cards, features, content splits",
    });
  }

  for (const comp of distinctiveComponents) {
    if (comp.type === "vertical-text") {
      tokens.push({
        category: "grid",
        value: "vertical-text-sidebar",
        usage: `display element: "${comp.label}"`,
      });
    }
    if (comp.type === "step-section") {
      tokens.push({
        category: "grid",
        value: "step-section",
        usage: comp.label,
      });
    }
  }

  const isInteractiveClass = (className: string) =>
    className.toLowerCase().includes("button") ||
    className.toLowerCase().includes("btn") ||
    className.toLowerCase().includes("cta");
  const interactiveTags = new Set(["BUTTON", "A", "INPUT", "LABEL"]);
  const radiusSamples = samples.filter((s) => {
    const value = s.borderRadius;
    if (!value || value === "0px") return false;
    if (!isUniformRadius(value)) return false;
    const px = parseFloat(value);
    if (!isNaN(px) && px >= 80) return false;
    return (
      interactiveTags.has(s.tagName) ||
      isInteractiveClass(s.className) ||
      s.className.toLowerCase().includes("card")
    );
  });
  const radii = radiusSamples.map((s) => s.borderRadius);
  const commonRadius = mostCommon(radii);
  if (commonRadius && !commonRadius.includes("100%")) {
    tokens.push({
      category: "radius",
      value: commonRadius,
      usage: "buttons, cards, interactive elements",
    });
  }

  const borderSamples = samples.filter((s) => {
    return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].some(
      (w) => w && w !== "0px",
    );
  });
  const widthCounts: Record<string, number> = {};
  const sideCounts: Record<string, Record<string, number>> = {};
  for (const s of borderSamples) {
    if (!interactiveTags.has(s.tagName) && !isInteractiveClass(s.className) && !s.className.toLowerCase().includes("card")) continue;
    const sides = [
      { width: s.borderTopWidth, label: "top" },
      { width: s.borderRightWidth, label: "right" },
      { width: s.borderBottomWidth, label: "bottom" },
      { width: s.borderLeftWidth, label: "left" },
    ];
    for (const { width, label } of sides) {
      if (width && width !== "0px") {
        widthCounts[width] = (widthCounts[width] ?? 0) + 1;
        if (!sideCounts[width]) sideCounts[width] = {};
        sideCounts[width][label] = (sideCounts[width][label] ?? 0) + 1;
      }
    }
  }
  const sortedWidths = Object.entries(widthCounts).sort((a, b) => b[1] - a[1]);
  const topWidth = sortedWidths[0];
  if (topWidth && topWidth[1] >= 2) {
    const width = topWidth[0];
    const px = parseFloat(width);
    const sides = sideCounts[width] ?? {};
    const dominantSide = Object.entries(sides).sort((a, b) => b[1] - a[1])[0];
    const isThick = !isNaN(px) && px >= 6;
    const isDirectional = dominantSide && dominantSide[1] >= topWidth[1] * 0.7;

    if (isThick && isDirectional && dominantSide) {
      tokens.push({
        category: "borderWidth",
        value: `${dominantSide[0]} ${width}`,
        usage: `${dominantSide[0]} accent border for section dividers and highlighted cards`,
      });
    } else {
      const label = isDirectional ? dominantSide[0] : "uniform";
      tokens.push({
        category: "borderWidth",
        value: formatBorderWidth(width),
        usage: `${label} border for outlined buttons, cards, and dividers`,
      });
    }
  }

  const maxWidths = samples
    .filter((s) => {
      if (!s.maxWidth || s.maxWidth === "none") return false;
      const lower = s.maxWidth.toLowerCase();
      if (lower === "100%" || lower === "100vw" || lower === "auto" || lower === "initial") return false;
      return s.tagName === "DIV" || s.tagName === "SECTION" || s.tagName === "MAIN" || s.tagName === "ARTICLE";
    })
    .map((s) => s.maxWidth);
  const commonMaxWidth = mostCommon(maxWidths);
  if (commonMaxWidth) {
    tokens.push({
      category: "maxWidth",
      value: commonMaxWidth,
      usage: "content container",
    });
  }

  const shadows = samples
    .filter((s) => s.boxShadow && s.boxShadow !== "none")
    .map((s) => s.boxShadow);
  const commonShadow = mostCommon(shadows);
  if (commonShadow) {
    tokens.push({
      category: "shadow",
      value: commonShadow,
      usage: "cards, dropdowns, modals",
    });
  }

  return tokens;
}

function mostCommon(values: string[]): string | null {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 && (sorted[0]?.[1] ?? 0) >= 2 ? sorted[0]![0] : null;
}

function formatBorderWidth(value: string): string {
  const parts = value.split(" ").filter((p) => p !== "0px");
  if (parts.length === 0) return value;
  if (parts.length === 1) return parts[0] ?? value;
  return value;
}

function dedupeLocations(locations: { name?: string; address?: string; hours?: string }[]): { name?: string; address?: string; hours?: string }[] {
  const byNumberZip = new Map<string, { name?: string; address?: string; hours?: string }>();
  for (const loc of locations) {
    const address = loc.address ?? "";
    const number = address.match(/\d+/)?.[0] ?? "";
    const zip = address.match(/\b\d{5}(-\d{4})?\b/)?.[0] ?? "";
    if (!number || !zip) continue;
    const key = `${number}|${zip}`;
    const existing = byNumberZip.get(key);
    if (!existing || (existing.address ?? "").split(/\s+/).length > address.split(/\s+/).length) {
      byNumberZip.set(key, loc);
    }
  }
  return Array.from(byNumberZip.values());
}

export async function scrapeWebsite(browser: Browser, options: ScrapeOptions): Promise<ScrapedWebsiteData> {
  const { url, takeScreenshot = true, screenshotPath, captureHtml = false, maxWaitMs = 5000 } = options;
  if (!isHttpUrl(url)) {
    throw new Error(`Scrape URL must use http:// or https://, got: ${url}`);
  }
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(maxWaitMs);

    const screenshotUrls: string[] = [];
    if (takeScreenshot) {
      const path = screenshotPath ?? `/tmp/scrape-${Date.now()}.png`;
      await page.screenshot({ path, fullPage: true });
      screenshotUrls.push(`file://${path}`);
    }

    const extracted = await runBrowserExtraction(page);

    const colors = buildColors(extracted.samples, extracted.extraColors);
    const fonts = buildFonts(extracted.samples);
    const typeScale = buildTypeScale(extracted.samples);
    const designTokens = buildDesignTokens(extracted.samples, extracted.grids, extracted.distinctiveComponents);

    const rawHtml = captureHtml ? await page.content() : undefined;

    return {
      url,
      title: extracted.businessName,
      description: extracted.tagline,
      businessName: extracted.businessName,
      tagline: extracted.headings[0] ?? extracted.tagline,
      headings: extracted.headings,
      paragraphs: extracted.paragraphs,
      buttons: extracted.buttons,
      navLinks: cleanNavLinks(extracted.navLinks),
      colors,
      fonts,
      fontSizes: typeScale,
      images: extracted.images,
      sections: extracted.sections,
      layoutRules: [
        { element: "Container", value: "max-width centered layout" },
      ],
      designTokens,
      faqs: dedupeFaqs(extracted.faqs),
      testimonials: extracted.testimonials,
      locations: dedupeLocations(extracted.locations),
      team: extracted.team,
      offerings: extracted.offerings,
      contact: {
        social: extractSocialProfiles(extracted.externalLinks),
      },
      screenshotUrls,
      rawHtml,
      headerCtaStyle: extracted.headerCtaStyle,
    };
  } finally {
    await page.close();
  }
}
