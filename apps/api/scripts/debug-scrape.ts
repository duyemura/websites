import "dotenv/config";
import { chromium } from "playwright";
import { scrapeWebsite } from "../src/utils/scrape-website";

async function main() {
  const url = process.argv[2] || "https://www.ksathleticclub.com/";
  const browser = await chromium.launch({ headless: true });
  try {
    const data = await scrapeWebsite(browser, { url, takeScreenshot: false, captureHtml: false, maxWaitMs: 5000 });
    console.log("businessName:", data.businessName);
    console.log("tagline:", data.tagline);
    console.log("\n--- images ---");
    for (const img of data.images) {
      console.log(JSON.stringify(img));
    }
    console.log("\n--- colors ---");
    for (const c of data.colors) {
      console.log(JSON.stringify(c));
    }
    console.log("\n--- fonts ---");
    for (const f of data.fonts) {
      console.log(JSON.stringify(f));
    }
    console.log("\n--- navLinks ---");
    for (const n of data.navLinks) {
      console.log(JSON.stringify(n));
    }

    console.log("\n--- generic sections ---");
    for (const s of data.sections ?? []) {
      console.log(JSON.stringify({ id: s.id, type: s.type, heading: s.heading, itemCount: s.items?.length, imageCount: s.images?.length }));
      if (s.items) {
        for (const item of s.items.slice(0, 8)) {
          console.log("  item:", JSON.stringify(item));
        }
      }
    }

    // Inspect DOM skeleton
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    const skeleton = await page.evaluate(String.raw`
      (function() {
        function describeNode(el, depth) {
          const tag = el.tagName.toLowerCase();
          const cls = (el.className || "").toString().split(" ").slice(0, 3).join(".");
          const id = el.id || "";
          const rect = el.getBoundingClientRect();
          return { tag, cls, id, height: rect.height, depth };
        }
        const body = document.body;
        const out = [];
        function walk(el, depth) {
          if (depth > 5) return;
          if (["script", "style", "svg"].indexOf(el.tagName.toLowerCase()) !== -1) return;
          out.push(describeNode(el, depth));
          for (const child of Array.from(el.children).slice(0, 10)) {
            walk(child, depth + 1);
          }
        }
        walk(body, 0);
        return out;
      })()
    `);
    console.log("\n--- DOM skeleton (depth <=5) ---");
    for (const s of skeleton as { tag: string; cls: string; id: string; height: number; depth: number }[]) {
      console.log("  ".repeat(s.depth) + s.tag + (s.id ? "#" + s.id : "") + (s.cls ? "." + s.cls : "") + " h=" + s.height);
    }

    // Check which direct children are considered section roots
    const rootCheck = await page.evaluate(String.raw`
      (function() {
        function isLikelySectionRoot(el) {
          const tag = el.tagName ? el.tagName.toLowerCase() : "";
          if (tag === "section" || tag === "article") return true;
          const cls = (el.className || "").toString().toLowerCase();
          const id = (el.id || "").toLowerCase();
          if (tag === "header" && (el.querySelector("h1") || /hero/i.test(cls) || /hero/i.test(id))) return true;
          const strongHints = ["section", "band", "hero", "feature", "about", "offer", "step", "process", "testimonial", "cta", "contact", "location", "faq", "review", "gallery"];
          if (strongHints.some(function(h) { return cls.includes(h) || id.includes(h); })) return true;
          return false;
        }
        return Array.from(document.body.children).map(function(c) {
          return { tag: c.tagName, cls: (c.className || "").toString(), id: c.id, isRoot: isLikelySectionRoot(c), height: c.getBoundingClientRect().height };
        });
      })()
    `);
    console.log("\n--- root check ---");
    for (const r of rootCheck as { tag: string; cls: string; id: string; isRoot: boolean; height: number }[]) {
      console.log(r.tag, r.isRoot, r.height, r.id, r.cls.slice(0, 60));
    }

    // Inspect logo candidates
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    const logoInfo = await page.evaluate(() => {
      const homeLinkSelectors = ['a[href="/"]', 'a[href="./"]', 'a[href*="ksathleticclub"]', 'header a', 'nav a'];
      const candidates: unknown[] = [];
      for (const sel of homeLinkSelectors) {
        for (const a of Array.from(document.querySelectorAll(sel)).slice(0, 10)) {
          const rect = a.getBoundingClientRect();
          const imgs = Array.from(a.querySelectorAll("img, svg"));
          for (const el of imgs) {
            const elRect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const src = tag === "img" ? (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src : null;
            const alt = tag === "img" ? (el as HTMLImageElement).alt : null;
            const className = (el.className || "").toString();
            candidates.push({
              selector: sel,
              tag,
              src,
              alt,
              className,
              aText: (a.textContent || "").trim().slice(0, 60),
              aWidth: rect.width,
              aHeight: rect.height,
              elWidth: elRect.width,
              elHeight: elRect.height,
              elTop: elRect.top,
            });
          }
        }
      }
      // Also find any image with class/alt/logo
      for (const img of Array.from(document.querySelectorAll("img"))) {
        const cls = (img.className || "").toString().toLowerCase();
        const alt = (img.alt || "").toLowerCase();
        if (cls.includes("logo") || cls.includes("brand") || alt.includes("logo") || alt.includes("brand")) {
          const rect = img.getBoundingClientRect();
          candidates.push({
            selector: "logo-class/alt",
            tag: "img",
            src: img.currentSrc || img.src,
            alt: img.alt,
            className: img.className,
            aText: "",
            aWidth: 0,
            aHeight: 0,
            elWidth: rect.width,
            elHeight: rect.height,
            elTop: rect.top,
          });
        }
      }
      return candidates;
    });
    console.log("\n--- logo candidates ---");
    for (const c of logoInfo) {
      console.log(JSON.stringify(c));
    }

    // Inspect all computed colors from a broad element set
    const allColors = await page.evaluate(String.raw`
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
        const selectors = "*";
        const all = Array.from(document.querySelectorAll(selectors)).slice(0, 300);
        const result = [];
        for (const el of all) {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area < 100) continue;
          const tag = el.tagName.toLowerCase();
          const cls = (el.className || "").toString().slice(0, 40);
          const id = el.id || "";
          const text = (el.textContent || "").trim().slice(0, 20);
          const bg = colorToHex(style.backgroundColor);
          const color = colorToHex(style.color);
          if (bg) result.push({ type: "bg", hex: bg, area, tag, cls, id, text });
          if (color) result.push({ type: "text", hex: color, area, tag, cls, id, text });
        }
        return result;
      })()
    `);
    console.log("\n--- all computed colors ---");
    // Aggregate by hex
    const byHex = new Map<string, { type: string; hex: string; area: number; tags: string[]; classes: string[]; texts: string[] }>();
    for (const c of allColors as { type: string; hex: string; area: number; tag: string; cls: string; id: string; text: string }[]) {
      const key = `${c.type}:${c.hex}`;
      const existing = byHex.get(key) ?? { type: c.type, hex: c.hex, area: 0, tags: [], classes: [], texts: [] };
      existing.area += c.area;
      if (!existing.tags.includes(c.tag)) existing.tags.push(c.tag);
      if (c.cls && !existing.classes.includes(c.cls)) existing.classes.push(c.cls);
      if (c.text && !existing.texts.includes(c.text)) existing.texts.push(c.text);
      byHex.set(key, existing);
    }
    const sorted = Array.from(byHex.values()).sort((a, b) => b.area - a.area);
    for (const c of sorted.slice(0, 30)) {
      console.log(JSON.stringify({ type: c.type, hex: c.hex, area: c.area, tags: c.tags.slice(0, 5), classes: c.classes.slice(0, 5), texts: c.texts.slice(0, 3) }));
    }

    // Inspect CSS variables and prominent computed colors
    const colorInfo = await page.evaluate(String.raw`
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
        const rootStyle = window.getComputedStyle(document.documentElement);
        const vars = [];
        for (let i = 0; i < rootStyle.length; i++) {
          const name = rootStyle[i];
          if (name.startsWith("--")) {
            const value = rootStyle.getPropertyValue(name);
            vars.push({ name: name, value: value, hex: colorToHex(value) });
          }
        }
        const prominent = [];
        const selectors = ["body", "header", ".navbar", ".logo", "h1", "a.button", ".button", ".btn", ".cta", ".primary-button", ".main-button", "section:first-of-type", ".hero-section"];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const style = window.getComputedStyle(el);
            prominent.push({
              selector: sel,
              text: (el.textContent || "").trim().slice(0, 30),
              bg: colorToHex(style.backgroundColor),
              color: colorToHex(style.color),
              className: (el.className || "").toString().slice(0, 60),
            });
          }
        }
        return { vars: vars, prominent: prominent };
      })()
    `);
    console.log("\n--- css variables (color) ---");
    for (const v of colorInfo.vars.filter((v) => v.hex).slice(0, 40)) {
      console.log(JSON.stringify(v));
    }
    console.log("\n--- prominent colors ---");
    for (const p of colorInfo.prominent) {
      console.log(JSON.stringify(p));
    }

    await page.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
