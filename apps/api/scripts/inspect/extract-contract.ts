import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  semanticScan,
  visualBoundaryScan,
  mergeCandidates,
  type SectionCandidate,
} from "../../src/utils/pipeline/segment-ladder";
import type { BBox } from "../../src/types/pipeline-artifacts";
import type {
  SectionContract,
  SectionLayoutArchetype,
  ItemBackground,
  KnownIcon,
} from "../../src/types/section-contract";

const URL = "https://beanburito.github.io/free-intro-session-self-book-in-person/";
const OUT = path.resolve(import.meta.dirname, "./output/beanburito");

async function ensureDir() {
  await mkdir(OUT, { recursive: true });
}

function verticalOverlap(a: BBox, b: BBox): number {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, bottom - top);
  return overlap / Math.min(a.height, b.height);
}

function mergeCandidatesLocal(primary: SectionCandidate[], secondary: SectionCandidate[]): SectionCandidate[] {
  const result = [...primary];
  for (const cand of secondary) {
    const overlaps = result.some((existing) => verticalOverlap(existing.boundingBox, cand.boundingBox) > 0.7);
    if (!overlaps) result.push(cand);
  }
  return result.sort((a, b) => a.boundingBox.y - b.boundingBox.y);
}

function rgbToHex(rgb: string): string | undefined {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return undefined;
  const toHex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

function inferIcon(text: string): KnownIcon {
  const t = text.toLowerCase();
  if (/class|reservation|schedule|book/.test(t)) return "calendar-check";
  if (/app|phone|mobile/.test(t)) return "phone";
  if (/time|clock|hour/.test(t)) return "clock";
  if (/ticket|reserve/.test(t)) return "ticket";
  if (/target|program|individual|age 65|over 65/.test(t)) return "target";
  if (/ring|gymnastic/.test(t)) return "rings";
  if (/muscle|strength/.test(t)) return "muscle";
  if (/price|dollar|cost|nutrition/.test(t)) return "nutrition";
  if (/location|address|direction/.test(t)) return "location";
  if (/mail|email/.test(t)) return "mail";
  return "none";
}

function inferLayoutArchetype(tag: string, dom: ReturnType<typeof analyzeSectionDom>): SectionLayoutArchetype {
  const { display, gridCols, hasAccordion, hasSticky, childCount, classHint } = dom;
  const lower = `${tag} ${classHint}`.toLowerCase();

  if (lower.includes("hero")) {
    if (dom.textAlign === "left" || dom.justifyContent === "flex-start") return "hero-left";
    if (dom.textAlign === "right" || dom.justifyContent === "flex-end") return "hero-right";
    return "hero-center";
  }
  if (lower.includes("faq") || hasAccordion) return "faq-accordion";
  if (lower.includes("testimonial")) return dom.scrollSnap || childCount > 3 ? "testimonial-scroll" : "testimonial-grid";
  if (lower.includes("step") || lower.includes("how it") || lower.includes("getting started")) return "steps-numbered";
  if (lower.includes("location") || lower.includes("find us")) return "location-split";
  if (lower.includes("cta") || lower.includes("ready to") || lower.includes("book your")) return "cta-band";
  if (lower.includes("community") || lower.includes("value") || lower.includes("why")) {
    if (display === "grid" && gridCols > 1) return "feature-grid-even";
    return "community-band";
  }
  if (lower.includes("program") || lower.includes("training")) {
    return hasSticky ? "program-cards-sticky" : "feature-grid-bento";
  }
  if (display === "grid") {
    if (gridCols === 3 && childCount >= 5) return "feature-grid-bento";
    return "feature-grid-even";
  }
  if (lower.includes("about") || lower.includes("content")) return "content-media";
  return "unknown";
}

function analyzeSectionDom(page: Page, box: BBox) {
  return page.evaluate((bbox) => {
    const root = document.elementFromPoint(bbox.x + bbox.width / 2, bbox.y + 10) as HTMLElement | null;
    if (!root) {
      return {
        display: "block",
        gridCols: 1,
        hasAccordion: false,
        hasSticky: false,
        childCount: 0,
        textAlign: "center",
        justifyContent: "normal",
        classHint: "",
        scrollSnap: false,
      };
    }

    // Walk up to the section-ish ancestor
    let el: HTMLElement | null = root;
    while (el && el !== document.body && (el as Element).tagName.toLowerCase() !== "section") {
      el = el.parentElement;
    }
    if (!el || el === document.body) el = root;

    const style = window.getComputedStyle(el);
    const display = style.display;
    const gridCols = style.gridTemplateColumns ? style.gridTemplateColumns.split(" ").length : 1;
    const textAlign = style.textAlign;
    const justifyContent = style.justifyContent;
    const classHint = typeof el.className === "string" ? el.className : "";

    const hasAccordion = Boolean(el.querySelector("details, [aria-expanded], [class*='accordion']"));
    const hasSticky = Array.from(el.querySelectorAll("*")).some((node) => {
      const s = window.getComputedStyle(node);
      return s.position === "sticky" || s.position === "fixed";
    });
    const scrollSnap = style.scrollSnapType && style.scrollSnapType !== "none";
    const childCount = Array.from(el.children).filter((c) => {
      const r = c.getBoundingClientRect();
      return r.height > 20;
    }).length;

    return { display, gridCols, hasAccordion, hasSticky, childCount, textAlign, justifyContent, classHint, scrollSnap };
  }, box);
}

async function extractSectionContract(page: Page, cand: SectionCandidate, index: number, pagePath: string): Promise<SectionContract> {
  const box = cand.boundingBox;
  const dom = await analyzeSectionDom(page, box);

  // Content extraction within the section
  const content = await page.evaluate((bbox) => {
    const root = document.elementFromPoint(bbox.x + bbox.width / 2, bbox.y + 10) as HTMLElement | null;
    let el: HTMLElement | null = root;
    while (el && el !== document.body && (el as Element).tagName.toLowerCase() !== "section") {
      el = el.parentElement;
    }
    if (!el || el === document.body) el = root;
    if (!el) {
      return { heading: "", body: "", cta: undefined, items: [], backgroundColor: "", backgroundImage: "", paddingTop: "", paddingBottom: "" };
    }

    const s = window.getComputedStyle(el);
    const heading = el.querySelector("h1, h2, h3")?.textContent?.trim() ?? "";
    const body = Array.from(el.querySelectorAll("p"))
      .map((p) => p.textContent?.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" ")
      .slice(0, 300);

    const ctaCandidates = Array.from(el.querySelectorAll("a, button")).filter((node) => {
      const text = node.textContent?.trim().toLowerCase() ?? "";
      const cls = typeof (node as HTMLElement).className === "string" ? (node as HTMLElement).className.toLowerCase() : "";
      return text.includes("book") || text.includes("free") || cls.includes("button") || cls.includes("cta");
    }) as HTMLElement[];
    const ctaEl = ctaCandidates[0];
    const cta = ctaEl
      ? {
          label: ctaEl.innerText?.trim().slice(0, 60) ?? "",
          href: (ctaEl as HTMLAnchorElement).href ?? "#",
        }
      : undefined;

    // Collect grid children if this section contains a CSS grid (inline loop to avoid __name issues).
    const gridContainers: Element[] = [];
    const stack: Element[] = [el];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of Array.from(cur.children)) {
        if ((child as HTMLElement).offsetHeight > 20) {
          const ds = window.getComputedStyle(child).display;
          if (ds === "grid" || ds === "inline-grid") gridContainers.push(child);
          stack.push(child);
        }
      }
    }
    const grid = gridContainers[0];
    let items: {
      title: string;
      body: string;
      background: string;
      hasImage: boolean;
      rect: { top: number; left: number; width: number; height: number };
      className: string;
      iconSvg?: string;
    }[] = [];

    if (grid) {
      const gridStyle = window.getComputedStyle(grid);
      const gridRect = grid.getBoundingClientRect();
      const colGaps = gridStyle.columnGap ? parseFloat(gridStyle.columnGap) : 0;
      const children = Array.from(grid.children).filter((c) => (c as HTMLElement).offsetHeight > 20);
      const colLefts = children
        .map((c) => c.getBoundingClientRect().left)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);
      const rowTops = children
        .map((c) => c.getBoundingClientRect().top)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);

      items = children.map((card) => {
        const cs = window.getComputedStyle(card);
        const rect = card.getBoundingClientRect();
        const title =
          card.querySelector("h3, h4, h5")?.textContent?.trim() ??
          Array.from(card.querySelectorAll("*"))
            .map((n) => n.textContent?.trim())
            .filter((t) => t && t.length > 2 && t.length < 80)[0] ??
          "";
        const cardBody = Array.from(card.querySelectorAll("p"))
          .map((p) => p.textContent?.trim())
          .filter(Boolean)
          .join(" ")
          .slice(0, 160);
        const bg = cs.backgroundColor;
        const hasImage = card.querySelector("img") !== null;
        const svg = card.querySelector("svg");
        const iconSvg = svg ? svg.outerHTML.slice(0, 400) : undefined;
        return {
          title,
          body: cardBody,
          background: bg,
          hasImage,
          rect: { top: rect.top - gridRect.top, left: rect.left - gridRect.left, width: rect.width, height: rect.height },
          className: typeof (card as HTMLElement).className === "string" ? (card as HTMLElement).className : "",
          iconSvg,
        };
      });
    } else {
      // Fallback to card-like children
      const cards = Array.from(el.querySelectorAll("[class*='card'], [class*='item'], [class*='tile'], [class*='feature'], [class*='cell']")).slice(0, 12);
      items = cards.map((card) => {
        const cs = window.getComputedStyle(card);
        const rect = card.getBoundingClientRect();
        const title = card.querySelector("h3, h4, h5, .heading, [class*='title']")?.textContent?.trim() ?? "";
        const cardBody = Array.from(card.querySelectorAll("p"))
          .map((p) => p.textContent?.trim())
          .filter(Boolean)
          .join(" ")
          .slice(0, 160);
        const bg = cs.backgroundColor;
        const hasImage = card.querySelector("img") !== null;
        return {
          title,
          body: cardBody,
          background: bg,
          hasImage,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          className: typeof (card as HTMLElement).className === "string" ? (card as HTMLElement).className : "",
        };
      });
    }

    return {
      heading,
      body,
      cta,
      items,
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage === "none" ? "" : s.backgroundImage,
      paddingTop: s.paddingTop,
      paddingBottom: s.paddingBottom,
    };
  }, box);

  const archetype = inferLayoutArchetype(cand.headingText || content.heading || cand.innerText || "", dom);
  const bgColor = rgbToHex(content.backgroundColor) ?? "#000000";

  // Map extracted items to contract items with grid positions
  const rowTops = content.items
    .map((i) => i.rect.top)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
  const colLefts = content.items
    .map((i) => i.rect.left)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);

  const contractItems = content.items.map((item, i) => {
    const itemBg: ItemBackground = item.hasImage
      ? "image"
      : rgbToHex(item.background) === "#2563ff" || item.background.includes("37, 99, 255")
        ? "accent"
        : rgbToHex(item.background) === "#000000" || item.background.includes("0, 0, 0")
          ? "dark"
          : "transparent";

    const colIndex = colLefts.indexOf(item.rect.left);
    const rowIndex = rowTops.indexOf(item.rect.top);
    const sameTopItems = content.items.filter((it) => it.rect.top === item.rect.top);
    const sameLeftItems = content.items.filter((it) => it.rect.left === item.rect.left);
    const colSpan = sameTopItems.length > 0 ? Math.round(item.rect.width / sameTopItems[0].rect.width) : 1;
    const rowSpan = sameLeftItems.length > 0 ? Math.round(item.rect.height / sameLeftItems[0].rect.height) : 1;

    let alignSelf: "start" | "end" | "stretch" | "center" | undefined;
    const centerItem = content.items.find((it) => it.rect.left === colLefts[Math.floor(colLefts.length / 2)]);
    if (centerItem) {
      const isCenter = item.rect.left === centerItem.rect.left;
      if (!isCenter) {
        // Bento staggering: top row outside items align end, bottom row align start
        if (rowIndex === 0) alignSelf = "end";
        else if (rowIndex >= rowTops.length - 1) alignSelf = "start";
      }
    }

    return {
      id: `item-${index}-${i}`,
      position: {
        col: colIndex >= 0 ? colIndex + 1 : undefined,
        row: rowSpan > 1 ? `${rowIndex + 1} / span ${rowSpan}` : String(rowIndex + 1),
        alignSelf,
      },
      background: itemBg,
      icon: inferIcon(item.title),
      imageUrl: item.hasImage ? undefined : undefined,
      title: item.title,
      body: item.body || undefined,
    };
  });

  return {
    id: `seg-${index}`,
    pagePath,
    tag: cand.landmarkTag as any || "unknown",
    sourceConfidence: cand.confidence,
    boundingBox: box,
    layout: {
      archetype,
      background: {
        color: bgColor,
        imageUrl: content.backgroundImage?.startsWith("url(") ? content.backgroundImage.slice(4, -1).replace(/["']/g, "") : undefined,
      },
      spacing: {
        top: content.paddingTop,
        bottom: content.paddingBottom,
      },
      separator: "none",
    },
    typography: {
      headline: content.heading
        ? {
            text: content.heading,
            align: dom.textAlign === "left" ? "left" : dom.textAlign === "right" ? "right" : "center",
          }
        : undefined,
    },
    interactions: {
      accordion: dom.hasAccordion,
      scrollSnap: dom.scrollSnap,
      stickyPanel: dom.hasSticky,
      hoverEffects: false,
    },
    items: contractItems,
    cta: content.cta
      ? {
          label: content.cta.label,
          href: content.cta.href,
        }
      : undefined,
    media: { imageUrls: [], videoUrls: [] },
  };
}

async function run() {
  await ensureDir();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);

  // Run the same ladder the pipeline uses
  const rung1 = await semanticScan(page);
  let candidates = rung1;
  if (candidates.length < 3) {
    const rung2 = await visualBoundaryScan(page);
    candidates = mergeCandidatesLocal(rung1, rung2);
  }

  // Skip header/footer landmarks for the contract demo
  const bodyCandidates = candidates.filter((c) => !c.landmarkTag);

  const contracts: SectionContract[] = [];
  for (let i = 0; i < bodyCandidates.length; i++) {
    const cand = bodyCandidates[i]!;
    contracts.push(await extractSectionContract(page, cand, i, "/"));
  }

  const artifact = {
    siteUuid: "inspect-beanburito",
    sourceSegmentAt: new Date().toISOString(),
    pages: [
      {
        path: "/",
        slug: "index",
        isHomePage: true,
        sections: contracts,
      },
    ],
  };

  await writeFile(path.join(OUT, "contract.json"), JSON.stringify(artifact, null, 2), "utf-8");
  console.log(`Contract extraction complete. ${contracts.length} sections. Output: ${OUT}/contract.json`);
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
