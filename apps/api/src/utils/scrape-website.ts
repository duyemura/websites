import type { Page, Browser } from "playwright";
import type {
  ScrapedColor,
  ScrapedDesignToken,
  ScrapedFont,
  ScrapedImage,
  ScrapedTextStyle,
} from "@ploy-gyms/shared-types";
import type { ScrapedWebsiteData } from "./scrape-docs";

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
  faqs: { question: string; answer: string }[];
  offerings: { name?: string; description?: string; price?: string }[];
  locations: { name?: string; address?: string; hours?: string }[];
  team: { name?: string; role?: string; bio?: string }[];
  testimonials: { quote: string; author?: string; role?: string }[];
  grids: { columns: number; element: string; className: string }[];
  distinctiveComponents: { type: string; label: string }[];
}

// Browser-side extraction as a string so esbuild/tsx function-name transforms
// (e.g. __name) do not leak into the browser context.
const BROWSER_EXTRACTION_SCRIPT = `
(function() {
  function colorToHex(color) {
    const match = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
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
    const rgbMatches = image.match(/rgba?\\([^)]+\\)/g) || [];
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
    "body", "header", "main", "section", "footer",
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
    const isButton =
      el.tagName === "BUTTON" ||
      className.toLowerCase().includes("button") ||
      className.toLowerCase().includes("btn");

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
  });

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
        label: ((el.textContent || "").trim().split("\\n")[0] || "").trim(),
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

  const title = document.title.replace(/\\s*\\|.*/g, "").trim();
  const businessName = title || headings[0] || "";
  const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
  const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute("content") || "";
  const tagline = metaDescription || ogDescription || paragraphs[0] || "";

  const images = Array.from(document.querySelectorAll("img"))
    .filter(function(img) {
      const rect = img.getBoundingClientRect();
      return rect.width >= 100 && rect.height >= 100;
    })
    .slice(0, 12)
    .map(function(img) {
      const rect = img.getBoundingClientRect();
      const src = img.currentSrc || img.src;
      const alt = img.alt || "";
      let context = "other";
      if (rect.width >= window.innerWidth * 0.8 && rect.top < window.innerHeight * 0.6) context = "hero";
      else if (alt.toLowerCase().includes("logo")) context = "logo";
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

  const offerings = [];
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

  const locations = [];
  const addressPattern = /\d+\s+[^\\n]{3,}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Pl|Place|Ct|Court)\b/i;
  const cityStatePattern = /\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Za-z\s]+\d{5}(-\d{4})?\b/;
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
    const cleaned = text.replace(/\\s+/g, " ").replace(/\\n+/g, ", ").trim();
    if (!cleaned || seenAddresses.has(cleaned)) return;
    if (cleaned.length < 15 || cleaned.length > 300) return;
    if (addressPattern.test(cleaned) || cityStatePattern.test(cleaned)) {
      seenAddresses.add(cleaned);
      locations.push({ address: cleaned });
    }
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
    locations: locations,
    team: team,
    testimonials: testimonials,
    grids: grids,
    distinctiveComponents: distinctiveComponents,
  };
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

  for (const s of samples) {
    const isButton = s.tagName === "BUTTON" || s.className.toLowerCase().includes("button") || s.className.toLowerCase().includes("btn");
    const isLink = s.tagName === "A";
    const isHeading = s.tagName.startsWith("H");
    const bg = toHex(s.backgroundColor);
    const fg = toHex(s.color);
    const bd = toHex(s.borderColor);

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

  // Assign roles. First pass: pick the strongest saturated color as the primary accent.
  const accentIndex = unique.findIndex((u) => {
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
    const role = roleForColor(u.hex, u.contexts);
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
    scale.push({
      element: label,
      mobile: baseToken,
      tablet: bumpTailwind(baseToken),
      desktop: bumpTailwind(bumpTailwind(baseToken)),
      notes,
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

export async function scrapeWebsite(browser: Browser, options: ScrapeOptions): Promise<ScrapedWebsiteData> {
  const { url, takeScreenshot = true, screenshotPath, captureHtml = false, maxWaitMs = 5000 } = options;
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
      navLinks: extracted.navLinks,
      colors,
      fonts,
      fontSizes: typeScale,
      images: extracted.images,
      layoutRules: [
        { element: "Container", value: "max-width centered layout" },
      ],
      designTokens,
      faqs: extracted.faqs,
      testimonials: extracted.testimonials,
      locations: extracted.locations,
      team: extracted.team,
      offerings: extracted.offerings,
      contact: {},
      screenshotUrls,
      rawHtml,
    };
  } finally {
    await page.close();
  }
}
