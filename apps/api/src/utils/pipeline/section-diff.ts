import { chromium, type Page } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BBox } from "../../types/pipeline-artifacts";

export interface ExtractedCard {
  title: string;
  background: string;
  hasIcon: boolean;
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface ExtractedSection {
  backgroundColor: string;
  items: ExtractedCard[];
  debug?: unknown;
}

export interface SectionMatch {
  heading: string;
  box: BBox;
}

export interface SectionDiffField {
  field: string;
  source: unknown;
  rendered: unknown;
  status: "match" | "mismatch-low" | "mismatch-high";
}

export interface SectionDiffReport {
  sourceUrl?: string;
  renderedUrl?: string;
  section: string;
  sourceHeading: string;
  renderedHeading: string;
  sourceBox: BBox;
  renderedBox: BBox;
  diffs: SectionDiffField[];
  sourceItems: Array<{
    title: string;
    col: number;
    row: number;
    background: ReturnType<typeof inferBackgroundClass>;
    hasIcon: boolean;
  }>;
  renderedItems: Array<{
    title: string;
    col: number;
    row: number;
    background: ReturnType<typeof inferBackgroundClass>;
    hasIcon: boolean;
  }>;
  sourceDebug?: unknown;
  renderedDebug?: unknown;
}

export function rgbToHex(rgb: string): string | undefined {
  const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return undefined;
  const toHex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${toHex(m[1]!)}${toHex(m[2]!)}${toHex(m[3]!)}`;
}

export function inferBackgroundClass(rgb: string): "accent" | "dark" | "transparent" | "image" {
  const hex = rgbToHex(rgb);
  if (hex === "#2563ff" || rgb.includes("37, 99, 255")) return "accent";
  if (hex === "#0063ff" || rgb.includes("0, 99, 255")) return "accent";
  // Treat fully-transparent rgba values as transparent, even if their color
  // channels happen to be black.
  const alphaMatch = rgb.match(/rgba\((?:\d+\s*,\s*){3}(\d+(?:\.\d+)?)\)/);
  if (alphaMatch && parseFloat(alphaMatch[1]!) === 0) return "transparent";
  if (hex === "#000000" || rgb.includes("0, 0, 0")) return "dark";
  return "transparent";
}

export async function findSectionByHeading(
  page: Page,
  headingContains: string,
): Promise<SectionMatch | null> {
  return page.evaluate(
    ({ needle }: { needle: string }) => {
      const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
      const target = headings.find((h) =>
        h.textContent?.toLowerCase().includes(needle.toLowerCase()),
      ) as HTMLElement | undefined;
      if (!target) return null;

      let el: HTMLElement | null = target;
      while (el && el !== document.body) {
        const r = el.getBoundingClientRect();
        if (r.height >= 300) break;
        el = el.parentElement;
      }
      if (!el || el === document.body) {
        el = target.closest("section") as HTMLElement | null;
      }
      if (!el) return null;

      const rect = el.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      return {
        heading: target.textContent?.trim() ?? "",
        box: {
          x: Math.max(0, Math.floor(rect.x + scrollX)),
          y: Math.max(0, Math.floor(rect.y + scrollY)),
          width: Math.max(1, Math.ceil(rect.width)),
          height: Math.max(1, Math.ceil(rect.height)),
        },
      };
    },
    { needle: headingContains },
  );
}

export interface ExtractCardsOptions {
  /** Skip headings whose text contains this string (case-insensitive). Useful to
   *  ignore the section headline when extracting cards. */
  excludeHeadingContains?: string;
}

export async function extractCardsFromSection(
  page: Page,
  box: BBox,
  options: ExtractCardsOptions = {},
): Promise<ExtractedSection> {
  return page.evaluate(
    ({ bbox, exclude }: { bbox: BBox; exclude?: string }) => {
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const probeY = bbox.y + Math.min(200, Math.max(50, Math.floor(bbox.height / 3))) - scrollY;
      const root = document.elementFromPoint(
        bbox.x + bbox.width / 2 - scrollX,
        probeY,
      ) as HTMLElement | null;
      let section: HTMLElement | null = root;
      while (section && section !== document.body && section.tagName.toLowerCase() !== "section") {
        section = section.parentElement;
      }
      if (!section || section === document.body) section = root;
      if (!section) {
        return {
          backgroundColor: "",
          items: [],
          debug: { reason: "no section" },
        };
      }

      let sectionBg = "rgba(0, 0, 0, 0)";
      for (let cur: Element | null = section; cur && cur !== document.body.parentElement; cur = cur.parentElement) {
        const rgb = window.getComputedStyle(cur).backgroundColor;
        if (!rgb.includes("rgba(0, 0, 0, 0)") && !rgb.includes("transparent")) {
          sectionBg = rgb;
          break;
        }
      }

      const headings = Array.from(section.querySelectorAll("h1, h2, h3, h4")) as HTMLElement[];
      const cards: Array<{
        el: HTMLElement;
        title: string;
        rect: DOMRect;
        bg: string;
        hasIcon: boolean;
      }> = [];
      const seen = new Set<Element>();

      for (const h of headings) {
        const text = h.textContent?.trim() ?? "";
        if (text.length < 2) continue;
        if (exclude && text.toLowerCase().includes(exclude.toLowerCase())) continue;
        const hr = h.getBoundingClientRect();
        if (hr.width < 40 || hr.height < 15) continue;

        let card: HTMLElement | null = null;
        let cur: HTMLElement | null = h.parentElement;
        while (cur && cur !== section) {
          const cr = cur.getBoundingClientRect();
          if (cr.width >= 80 && cr.height >= 80) {
            const hasIcon =
              cur.querySelector("svg, img, picture, figure, [class*='icon'], [class*='svg']") !== null;
            let hasVisibleBg = false;
            const stack = [cur];
            while (stack.length) {
              const node = stack.pop()!;
              const s = window.getComputedStyle(node);
              if (
                s.display === "none" ||
                s.visibility === "hidden" ||
                (node as HTMLElement).className?.toString().includes("w-condition-invisible")
              ) {
                continue;
              }
              const rgb = s.backgroundColor;
              if (!rgb.includes("rgba(0, 0, 0, 0)") && !rgb.includes("transparent")) {
                hasVisibleBg = true;
                break;
              }
              if (s.backgroundImage && s.backgroundImage !== "none") {
                hasVisibleBg = true;
                break;
              }
              for (const child of Array.from(node.children)) stack.push(child as HTMLElement);
            }
            const isCardLike = /card|item|benefit|feature|bento|tile|cell/i.test(
              cur.className?.toString() ?? "",
            );
            if (hasIcon || hasVisibleBg || isCardLike) {
              card = cur;
              break;
            }
          }
          cur = cur.parentElement;
        }
        if (!card || seen.has(card)) continue;
        seen.add(card);

        const cr = card.getBoundingClientRect();
        const cardBg = (function () {
          for (const el of Array.from(card.querySelectorAll("[class*='gradient']"))) {
            const s = window.getComputedStyle(el);
            const cls = (el as HTMLElement).className?.toString() ?? "";
            if (s.display === "none" || s.visibility === "hidden" || cls.includes("w-condition-invisible")) continue;
            const rgb = s.backgroundColor;
            if (!rgb.includes("rgba(0, 0, 0, 0)") && !rgb.includes("transparent")) return rgb;
          }
          let bestArea = 0;
          let bestBg = "rgba(0, 0, 0, 0)";
          const stack = [card];
          while (stack.length) {
            const node = stack.pop()!;
            const s = window.getComputedStyle(node);
            const cls = (node as HTMLElement).className?.toString() ?? "";
            if (s.display === "none" || s.visibility === "hidden" || cls.includes("w-condition-invisible")) continue;
            const r = node.getBoundingClientRect();
            const area = r.width * r.height;
            const rgb = s.backgroundColor;
            if (area > bestArea && !rgb.includes("rgba(0, 0, 0, 0)") && !rgb.includes("transparent")) {
              bestArea = area;
              bestBg = rgb;
            }
            for (const child of Array.from(node.children)) stack.push(child as HTMLElement);
          }
          return bestBg === "rgba(0, 0, 0, 0)" ? sectionBg : bestBg;
        })();

        cards.push({
          el: card,
          title: text,
          rect: cr,
          bg: cardBg,
          hasIcon:
            card.querySelector("svg, img, picture, figure, [class*='icon'], [class*='svg']") !== null,
        });
      }

      const tolerance = 8;
      const colRaw = Array.from(new Set(cards.map((c) => Math.round(c.rect.left)))).sort((a, b) => a - b);
      const colLefts: number[] = [];
      for (const v of colRaw) {
        const last = colLefts[colLefts.length - 1];
        if (last === undefined || Math.abs(v - last) > tolerance) colLefts.push(v);
      }
      const rowRaw = Array.from(new Set(cards.map((c) => Math.round(c.rect.top)))).sort((a, b) => a - b);
      const rowTops: number[] = [];
      for (const v of rowRaw) {
        const last = rowTops[rowTops.length - 1];
        if (last === undefined || Math.abs(v - last) > tolerance) rowTops.push(v);
      }

      const items = cards
        .map((card) => {
          const rect = card.rect;
          return {
            title: card.title,
            background: card.bg,
            hasIcon: card.hasIcon,
            col: colLefts.indexOf(Math.round(rect.left)) + 1,
            row: rowTops.indexOf(Math.round(rect.top)) + 1,
            width: rect.width,
            height: rect.height,
          };
        })
        .sort((a, b) => (a.row - b.row) * 10 + (a.col - b.col));

      return {
        backgroundColor: sectionBg,
        items,
        debug: {
          headings: headings.length,
          cards: cards.length,
          sectionTag: section.tagName,
          sectionClass: section.className,
        },
      };
    },
    { bbox: box, exclude: options.excludeHeadingContains },
  );
}

export async function captureSectionCrop(
  page: Page,
  box: BBox,
  outPath: string,
): Promise<void> {
  await mkdir(path.dirname(outPath), { recursive: true });
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const safeBox = {
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    width: Math.min(box.width, 1440 - box.x),
    height: Math.min(box.height, Math.max(1, pageHeight - box.y)),
  };
  await page.screenshot({
    path: outPath,
    fullPage: true,
    clip: safeBox,
  });
}

export function computeSectionDiff(
  sourceHeading: string,
  renderedHeading: string,
  sourceBox: BBox,
  renderedBox: BBox,
  source: ExtractedSection,
  rendered: ExtractedSection,
  threshold = 1,
): SectionDiffReport {
  const diffs: SectionDiffField[] = [];

  const sourceBg = inferBackgroundClass(source.backgroundColor);
  const renderedBg = inferBackgroundClass(rendered.backgroundColor);
  diffs.push({
    field: "section background color",
    source: { hex: rgbToHex(source.backgroundColor), class: sourceBg },
    rendered: { hex: rgbToHex(rendered.backgroundColor), class: renderedBg },
    status: sourceBg === renderedBg ? "match" : "mismatch-high",
  });

  diffs.push({
    field: "item count",
    source: source.items.length,
    rendered: rendered.items.length,
    status: source.items.length === rendered.items.length ? "match" : "mismatch-high",
  });

  const sourceCols = new Set(source.items.map((i) => i.col)).size;
  const renderedCols = new Set(rendered.items.map((i) => i.col)).size;
  diffs.push({
    field: "grid column count",
    source: sourceCols,
    rendered: renderedCols,
    status: sourceCols === renderedCols ? "match" : "mismatch-high",
  });

  const sourceRows = new Set(source.items.map((i) => i.row)).size;
  const renderedRows = new Set(rendered.items.map((i) => i.row)).size;
  diffs.push({
    field: "grid row count",
    source: sourceRows,
    rendered: renderedRows,
    status: sourceRows === renderedRows ? "match" : "mismatch-high",
  });

  const sourceAccentCount = source.items.filter((i) => inferBackgroundClass(i.background) === "accent").length;
  const renderedAccentCount = rendered.items.filter((i) => inferBackgroundClass(i.background) === "accent").length;
  const accentMatchRate = sourceAccentCount > 0 ? renderedAccentCount / sourceAccentCount : renderedAccentCount === 0 ? 1 : 0;
  diffs.push({
    field: "accent tile count",
    source: sourceAccentCount,
    rendered: renderedAccentCount,
    status: accentMatchRate >= threshold ? "match" : accentMatchRate > 0 ? "mismatch-low" : "mismatch-high",
  });

  const sourceTitles = source.items.map((i) => i.title.toLowerCase()).filter(Boolean);
  const renderedTitles = rendered.items.map((i) => i.title.toLowerCase()).filter(Boolean);
  const matchedTitles = sourceTitles.filter((t) =>
    renderedTitles.some((rt) => rt.includes(t) || t.includes(rt)),
  ).length;
  const titleMatchRate = sourceTitles.length > 0 ? matchedTitles / sourceTitles.length : 0;
  diffs.push({
    field: "item title match rate",
    source: `${sourceTitles.length} titles`,
    rendered: `${renderedTitles.length} titles`,
    status: titleMatchRate >= threshold ? "match" : titleMatchRate >= 0.5 ? "mismatch-low" : "mismatch-high",
  });

  const sourceIcons = source.items.filter((i) => i.hasIcon).length;
  const renderedIcons = rendered.items.filter((i) => i.hasIcon).length;
  const iconMatchRate = sourceIcons > 0 ? renderedIcons / sourceIcons : renderedIcons === 0 ? 1 : 0;
  diffs.push({
    field: "icon presence",
    source: `${sourceIcons}/${source.items.length}`,
    rendered: `${renderedIcons}/${rendered.items.length}`,
    status: iconMatchRate >= threshold ? "match" : iconMatchRate > 0 ? "mismatch-low" : "mismatch-high",
  });

  return {
    section: "feature-grid",
    sourceHeading,
    renderedHeading,
    sourceBox,
    renderedBox,
    diffs,
    sourceItems: source.items.map((i) => ({
      title: i.title,
      col: i.col,
      row: i.row,
      background: inferBackgroundClass(i.background),
      hasIcon: i.hasIcon,
    })),
    renderedItems: rendered.items.map((i) => ({
      title: i.title,
      col: i.col,
      row: i.row,
      background: inferBackgroundClass(i.background),
      hasIcon: i.hasIcon,
    })),
    sourceDebug: source.debug,
    renderedDebug: rendered.debug,
  };
}

export async function writeReport(outDir: string, report: SectionDiffReport): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const out = path.join(outDir, "report.json");
  await writeFile(out, JSON.stringify(report, null, 2), "utf-8");
  return out;
}

export async function launchBrowser() {
  return chromium.launch({ headless: true });
}

export async function newDesktopContext(browser: Awaited<ReturnType<typeof launchBrowser>>) {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
}
