import { chromium, type Page } from "playwright";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";

import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import {
  loadArtifact,
  saveArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";
import type {
  ExtractArtifact,
  SegmentArtifact,
  SegmentSection,
} from "../../types/pipeline-artifacts";
import {
  ContractArtifactSchema,
  type ContractArtifact,
  type ContractPage,
  type SectionContract,
  type SectionLayoutArchetype,
  type SectionItem,
} from "../../types/section-contract";
import { extractCardsFromSection, findSectionByHeading } from "../../utils/pipeline/section-diff";

export interface ContractStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  /** Optional scope: only contract these page paths. */
  pages?: string[];
}

/**
 * Build a ContractArtifact from the latest segment (and extract) artifacts.
 *
 * For each in-scope page, the stage opens the live source URL and derives a
 * renderer-ready SectionContract per section using DOM + computed styles.
 * Currently feature-grid sections get the richest contract; other sections are
 * classified by tag and basic domStyles.
 */
export async function runContractStage(input: ContractStageInput): Promise<ContractArtifact> {
  const ctx: ArtifactContext = {
    siteUuid: input.siteUuid,
    workspaceUuid: input.workspaceUuid,
  };

  const extract = await loadArtifact<ExtractArtifact>(input.db, ctx, "extract");
  if (!extract) throw new Error(`Extract artifact missing for site ${input.siteUuid}`);
  const segment = await loadArtifact<SegmentArtifact>(input.db, ctx, "segment");
  if (!segment) throw new Error(`Segment artifact missing for site ${input.siteUuid}`);

  const scope = input.pages
    ? segment.payload.pages.filter((p) => input.pages!.includes(p.path))
    : segment.payload.pages;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const contractPages: ContractPage[] = [];

  try {
    for (const segmentPage of scope) {
      const extractPage = extract.payload.pages.find((p) => p.path === segmentPage.path);
      if (!extractPage) continue;

      const pageUrl = new URL(segmentPage.path, extract.payload.url).toString();
      const page = await context.newPage();
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1500);

      const sections: SectionContract[] = [];
      for (const segSection of segmentPage.sections) {
        const contract = await buildSectionContract(page, segmentPage.path, segSection);
        sections.push(contract);
      }

      await page.close();

      contractPages.push({
        path: segmentPage.path,
        slug: segmentPage.path === "/" ? "index" : segmentPage.path.replace(/^\/+|\/+$/g, "").replace(/[^\w.-]+/g, "-"),
        isHomePage: segmentPage.path === "/",
        sections,
      });
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }

  const artifact = ContractArtifactSchema.parse({
    siteUuid: input.siteUuid,
    sourceSegmentAt: segment.payload.sourceExtractAt,
    pages: contractPages,
  });

  await saveArtifact(input.db, ctx, "contract", artifact);
  return artifact;
}

async function buildSectionContract(
  page: Page,
  pagePath: string,
  section: SegmentSection,
): Promise<SectionContract> {
  const domStyles = section.domStyles?.lg ?? section.domStyles?.md ?? section.domStyles?.base ?? {};

  let archetype = inferArchetype(section, domStyles);
  const background = await inferBackground(page, section);
  const interactions = await inferInteractions(page, section);
  const items = archetype.startsWith("feature-grid")
    ? await inferFeatureGridItems(page, section)
    : undefined;

  // Feature-grids that link to program pages are the homepage programs section.
  if (archetype.startsWith("feature-grid") && await sectionHasProgramLinks(page, section)) {
    archetype = "program-cards-sticky";
  }

  const spacing = {
    top: domStyles.padding ?? "0px",
    bottom: domStyles.padding ?? "0px",
  };

  return {
    id: section.id,
    pagePath,
    tag: section.tag,
    sourceConfidence: section.confidence,
    boundingBox: section.boundingBox,
    layout: {
      archetype,
      background,
      spacing,
      separator: "none",
    },
    typography: {
      headline: section.headingText
        ? {
            text: section.headingText,
            align: (domStyles.textAlign as "left" | "center" | "right") ?? "center",
            size: domStyles.headingFontSize,
            weight: domStyles.headingFontWeight,
            transform: domStyles.headingTextTransform,
            color: domStyles.headingColor,
          }
        : undefined,
    },
    interactions,
    items: items ?? [],
    media: { imageUrls: section.mediaUrls, videoUrls: [] },
  };
}

export function inferArchetype(
  section: SegmentSection,
  domStyles: Record<string, string | undefined>,
): SectionLayoutArchetype {
  const tag = section.tag;
  if (tag === "feature-grid" || tag === "content-block") {
    // Even vs bento is determined by whether all cards share the same bounding box.
    return "feature-grid-even";
  }
  if (tag === "hero") {
    const dir = domStyles.flexDirection;
    const align = domStyles.textAlign;
    if (dir?.includes("row")) return align === "right" ? "hero-right" : "hero-left";
    return "hero-center";
  }
  if (tag === "cta-band") return "cta-band";
  if (tag === "faq-block") return "faq-accordion";
  if (tag === "testimonial-band") return "testimonial-scroll";
  if (tag === "steps-band") return "steps-numbered";
  if (tag === "location-block") return "location-split";
  if (tag === "media-block") return "content-media";
  return "unknown";
}

async function inferBackground(
  page: Page,
  section: SegmentSection,
): Promise<{ color?: string; imageUrl?: string; gradient?: string }> {
  return page.evaluate(
    ({ bbox }: { bbox: import("../../types/pipeline-artifacts").BBox }) => {
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const probeY = bbox.y + Math.min(200, Math.max(50, Math.floor(bbox.height / 3))) - scrollY;
      let el: Element | null = document.elementFromPoint(
        bbox.x + bbox.width / 2 - scrollX,
        probeY,
      );
      while (el && el !== document.body && el.tagName.toLowerCase() !== "section") {
        el = el.parentElement;
      }
      if (!el || el === document.body) {
        el = document.elementFromPoint(bbox.x + bbox.width / 2 - scrollX, probeY);
      }
      if (!el) return {};

      let color: string | undefined;
      let imageUrl: string | undefined;
      let gradient: string | undefined;

      for (let cur: Element | null = el; cur && cur !== document.body.parentElement; cur = cur.parentElement) {
        const s = window.getComputedStyle(cur);
        const rgb = s.backgroundColor;
        if (!rgb.includes("rgba(0, 0, 0, 0)") && !rgb.includes("transparent")) {
          color = rgb;
          break;
        }
        if (!gradient && s.backgroundImage && s.backgroundImage.startsWith("linear-gradient")) {
          gradient = s.backgroundImage;
        }
      }

      // Look for a full-cover background image on the section or its first painted child.
      for (const node of [el, ...Array.from(el.children).slice(0, 4)]) {
        const s = window.getComputedStyle(node);
        const bi = s.backgroundImage;
        if (bi && bi !== "none" && !bi.startsWith("linear-gradient") && !bi.startsWith("radial-gradient")) {
          const m = bi.match(/url\(["']?([^"')]+)["']?\)/);
          if (m) {
            imageUrl = m[1];
            break;
          }
        }
      }

      return { color, imageUrl, gradient };
    },
    { bbox: section.boundingBox },
  );
}

async function inferInteractions(
  page: Page,
  section: SegmentSection,
): Promise<{ accordion: boolean; scrollSnap: boolean; stickyPanel: boolean; hoverEffects: boolean }> {
  return page.evaluate(
    ({ bbox }: { bbox: import("../../types/pipeline-artifacts").BBox }) => {
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const probeY = bbox.y + Math.min(200, Math.max(50, Math.floor(bbox.height / 3))) - scrollY;
      let el: Element | null = document.elementFromPoint(
        bbox.x + bbox.width / 2 - scrollX,
        probeY,
      );
      while (el && el !== document.body && el.tagName.toLowerCase() !== "section") {
        el = el.parentElement;
      }
      if (!el || el === document.body) {
        el = document.elementFromPoint(bbox.x + bbox.width / 2 - scrollX, probeY);
      }
      if (!el) {
        return { accordion: false, scrollSnap: false, stickyPanel: false, hoverEffects: false };
      }

      const accordion = el.querySelector("details, [role='tabpanel'], .accordion, [class*='accordion']") !== null;
      let scrollSnap = false;
      let stickyPanel = false;
      let hoverEffects = false;

      const stack: Element[] = [el];
      while (stack.length) {
        const cur = stack.pop()!;
        const s = window.getComputedStyle(cur);
        if (!scrollSnap && (s.scrollSnapType !== "none" || s.scrollSnapAlign !== "none")) scrollSnap = true;
        if (!stickyPanel && s.position === "sticky") stickyPanel = true;
        if (!hoverEffects && (s.transitionDuration !== "0s" || cur.matches("[class*='hover'],[class*='animate']"))) hoverEffects = true;
        for (const child of Array.from(cur.children)) stack.push(child);
      }

      return { accordion, scrollSnap, stickyPanel, hoverEffects };
    },
    { bbox: section.boundingBox },
  );
}

async function sectionHasProgramLinks(
  page: Page,
  section: SegmentSection,
): Promise<boolean> {
  return page.evaluate(
    ({ bbox }: { bbox: import("../../types/pipeline-artifacts").BBox }) => {
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const probeY = bbox.y + Math.min(200, Math.max(50, Math.floor(bbox.height / 3))) - scrollY;
      let el: Element | null = document.elementFromPoint(
        bbox.x + bbox.width / 2 - scrollX,
        probeY,
      );
      while (el && el !== document.body && el.tagName.toLowerCase() !== "section") {
        el = el.parentElement;
      }
      if (!el || el === document.body) {
        el = document.elementFromPoint(bbox.x + bbox.width / 2 - scrollX, probeY);
      }
      if (!el) return false;

      const links = Array.from(el.querySelectorAll("a[href]"));
      return links.some((a) => /\/programs\b|\/program\b|program/i.test(a.getAttribute("href") || "")
      );
    },
    { bbox: section.boundingBox },
  );
}

async function inferFeatureGridItems(
  page: Page,
  section: SegmentSection,
): Promise<SectionItem[]> {
  const headingContains = section.headingText ?? "";
  const found = headingContains
    ? await findSectionByHeading(page, headingContains)
    : null;

  if (!found) {
    // Fallback: scroll into the section box and extract cards directly.
    await page.evaluate((y) => window.scrollTo(0, y), section.boundingBox.y);
    await page.waitForTimeout(300);
  } else {
    await page.evaluate((y) => window.scrollTo(0, y), found.box.y);
    await page.waitForTimeout(300);
  }

  const box = found?.box ?? section.boundingBox;
  const data = await extractCardsFromSection(page, box, {
    excludeHeadingContains: found?.heading ?? section.headingText ?? undefined,
  });

  return data.items.map((card, i) => ({
    id: `${section.id}-item-${i}`,
    position: { col: card.col, row: String(card.row) },
    background: inferItemBackground(card.background),
    icon: "none", // icon mapping is left to the renderer / content mapper
    title: card.title,
  }));
}

export function inferItemBackground(bg: string): SectionItem["background"] {
  const rgb = bg.toLowerCase();
  if (rgb.includes("0, 99, 255") || rgb.includes("37, 99, 255")) return "accent";
  // Fully-transparent rgba values are transparent even if color channels are black.
  const alphaMatch = rgb.match(/rgba\((?:\d+\s*,\s*){3}(\d+(?:\.\d+)?)\)/);
  if (alphaMatch && parseFloat(alphaMatch[1]!) === 0) return "transparent";
  if (rgb.includes("0, 0, 0")) return "dark";
  if (rgb.includes("transparent")) return "transparent";
  return "image";
}
