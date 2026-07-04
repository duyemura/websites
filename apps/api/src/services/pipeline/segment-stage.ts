import { chromium, type Page } from "playwright";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";

import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import {
  SegmentArtifactSchema,
  type ExtractArtifact,
  type SegmentArtifact,
  type SegmentSection,
  type CanonicalSectionTag,
} from "../../types/pipeline-artifacts";
import {
  runLadder,
  type SectionCandidate,
} from "../../utils/pipeline/segment-ladder";
import { fillGaps } from "../../utils/pipeline/segment-merge";
import { classifySections } from "../../utils/pipeline/section-classifier";
import {
  fingerprintSections,
  resolveSharedComponents,
} from "../../utils/pipeline/shared-components";
import {
  saveArtifact,
  loadArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";
import { uploadPipelineImage } from "../../utils/pipeline/s3-upload";
import { imageUrlToDataUri, type S3Context } from "../../utils/pipeline/image-to-data-url";
import { chatCompletion } from "../../ai/llm-client";
import { modelForTask } from "../../ai/model-picker";

export interface SegmentStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  pages?: string[];
}

/**
 * Runs the segment stage: for every in-scope page from the extract artifact,
 * segments the page into candidate sections via the ladder (semantic → visual
 * → vision), classifies each section, crops it at 1440 and 375, uploads the
 * crops to S3, then cross-page fingerprints and resolves shared components.
 * Merges with any prior segment artifact (fresh overwrites by path).
 */
export async function runSegmentStage(
  input: SegmentStageInput,
): Promise<SegmentArtifact> {
  const ctx: ArtifactContext = {
    siteUuid: input.siteUuid,
    workspaceUuid: input.workspaceUuid,
  };

  const extract = await loadArtifact<ExtractArtifact>(input.db, ctx, "extract");
  if (!extract) {
    throw new Error("No extract artifact found — run the extract stage first.");
  }

  const scope = input.pages
    ? extract.payload.pages.filter((p) => input.pages!.includes(p.path))
    : extract.payload.pages;

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const artifactPages: SegmentArtifact["pages"] = [];

  const chatFn = (req: {
    model?: string;
    messages: Array<{ role: "user"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) =>
    chatCompletion(
      {
        model: req.model ?? modelForTask("default", input.config),
        messages: req.messages,
        temperature: req.temperature,
        maxTokens: req.maxTokens,
      },
      input.config,
    );

  try {
    for (const extractPage of scope) {
      const pageUrl = new URL(
        extractPage.path,
        extract.payload.url,
      ).toString();
      const page = await context.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(2000);

      // ---- ladder with real vision fallback ----
      const s3ctx: S3Context = {
        s3: input.s3,
        bucket: input.config.S3_ASSETS_BUCKET,
        region: input.config.S3_REGION,
        endpoint: input.config.S3_ENDPOINT,
      };
      const ladderResult = await runLadder(page, {
        needsVisionSegmentation: extractPage.flags.needsVisionSegmentation,
        visionSegment: () =>
          visionSegment(
            input.config,
            extractPage.screenshots.full1440,
            page,
            s3ctx,
          ),
      });

      const pageHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      const filled = fillGaps(ladderResult.candidates, pageHeight, 1440);

      // ---- classify ----
      // Only run the text classifier for candidates that the vision model didn't
      // already type — vision candidates have empty innerText so the text
      // classifier would return "unknown" for them anyway.
      const tags = await classifySections(
        filled.map((c) => ({
          headingText: c.headingText,
          innerText: c.innerText,
          landmarkTag: c.landmarkTag,
          // Pass visionTag through so the classifier can skip those candidates.
          visionTag: c.visionTag,
        })),
        chatFn,
      );

      // ---- desktop crops ----
      const prefix = `workspaces/${input.workspaceUuid}/sites/${input.siteUuid}/pipeline/segment`;
      const pageKey =
        extractPage.path === "/"
          ? "index"
          : extractPage.path
              .replace(/^\/+|\/+$/g, "")
              .replace(/[^\w.-]+/g, "-");
      const sections: SegmentSection[] = [];

      for (let i = 0; i < filled.length; i++) {
        const cand = filled[i]!;
        const clip = clampClip(cand.boundingBox, 1440, pageHeight);
        const desktopCrop = await page.screenshot({ fullPage: true, clip });
        const desktop = await uploadPipelineImage(
          input.s3,
          input.config,
          `${prefix}/${pageKey}-${i}-1440.png`,
          desktopCrop,
        );
        // Extract computed styles from the live DOM for this section's bounding box.
        // These are passed to the build stage so the LLM gets exact values (colors,
        // font weights, overlay opacity, CTA position) rather than guessing from screenshots.
        const domStyles = await extractSectionDomStyles(page, cand.boundingBox);
        // Prefer: landmark > visionTag > text-classifier result > unknown
        const tag: CanonicalSectionTag =
          cand.source === "gap-fill" ? "unknown"
          : (cand.visionTag as CanonicalSectionTag | undefined) ?? tags[i] ?? "unknown";
        const source: SegmentSection["source"] =
          cand.source === "gap-fill" ? "visual-boundary" : cand.source;
        sections.push({
          id: `${pageKey}-seg-${i}`,
          tag,
          order: i,
          confidence: cand.confidence,
          source,
          boundingBox: cand.boundingBox,
          crops: { desktop, mobile: "" },
          innerText: cand.innerText,
          headingText: cand.headingText,
          mediaUrls: mediaInBox(extractPage.media, cand.boundingBox),
          interactionIds: interactionsInBox(
            extractPage.interactions,
            cand.boundingBox,
          ),
          domStyles,
        });
      }

      // ---- mobile crops (proportional mapping) ----
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(500);
      const mobileHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      const ratio = mobileHeight / Math.max(1, pageHeight);
      for (const section of sections) {
        const box375 = {
          x: 0,
          y: Math.round(section.boundingBox.y * ratio),
          width: 375,
          height: Math.max(
            60,
            Math.round(section.boundingBox.height * ratio),
          ),
        };
        const mobileClip = clampClip(box375, 375, mobileHeight);
        const mobileCrop = await page.screenshot({
          fullPage: true,
          clip: mobileClip,
        });
        section.boundingBox375 = box375;
        section.crops.mobile = await uploadPipelineImage(
          input.s3,
          input.config,
          `${prefix}/${section.id}-375.png`,
          mobileCrop,
        );
      }

      await page.close();
      artifactPages.push({
        path: extractPage.path,
        sections,
        ladder: ladderResult.ladder,
      });
    }
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }

  // ---- cross-page fingerprinting (merge with previously segmented pages) ----
  const existing = await loadArtifact<SegmentArtifact>(input.db, ctx, "segment");
  const freshPaths = new Set(artifactPages.map((p) => p.path));
  const allPages: SegmentArtifact["pages"] = [
    ...artifactPages,
    ...(existing?.payload.pages.filter((p) => !freshPaths.has(p.path)) ?? []),
  ];

  const prints = fingerprintSections(
    allPages.flatMap((p) =>
      p.sections.map((s) => ({
        pageId: p.path,
        sectionId: s.id,
        tag: s.tag,
        innerText: s.innerText,
        mediaUrls: s.mediaUrls,
        aspectRatio: s.boundingBox.width / Math.max(1, s.boundingBox.height),
      })),
    ),
  );
  const shared = resolveSharedComponents(prints);

  // Map "pageId:sectionId" → shared component id so we can annotate.
  const sharedByMember = new Map<string, string>();
  for (const comp of shared) {
    for (const member of comp.memberSectionIds) {
      sharedByMember.set(member, comp.id);
    }
  }
  for (const p of allPages) {
    for (const s of p.sections) {
      const id = sharedByMember.get(`${p.path}:${s.id}`);
      if (id) s.sharedComponentId = id;
    }
  }

  const artifact = SegmentArtifactSchema.parse({
    siteUuid: input.siteUuid,
    sourceExtractAt: extract.payload.extractedAt,
    pages: allPages,
    sharedComponents: shared.map((c) => ({
      id: c.id,
      tag: c.tag as CanonicalSectionTag,
      memberSectionIds: c.memberSectionIds,
      resolution: c.resolution,
      propFields: c.propFields,
    })),
  });
  await saveArtifact(input.db, ctx, "segment", artifact);
  return artifact;
}

async function visionSegment(
  config: Config,
  fullPageScreenshotUrl: string,
  page: Page,
  s3ctx?: S3Context,
): Promise<SectionCandidate[]> {
  const pageHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const prompt = `This is a full-page screenshot of a gym website. Identify each visually distinct content section top to bottom. Return ONLY a JSON array: [{"type": "hero|feature-grid|testimonial-band|cta-band|content-block|media-block|location-block|faq-block|schedule|team|contact|unknown", "y_start_pct": number, "y_end_pct": number}] where percentages are 0-100 of total page height.`;
  try {
    const response = await chatCompletion(
      {
        model: modelForTask("vision", config),
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: await imageUrlToDataUri(fullPageScreenshotUrl, s3ctx) },
              },
            ],
          },
        ],
        temperature: 0,
        maxTokens: 1024,
      },
      config,
    );
    const match = response.content.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(match ? match[0] : "[]") as Array<{
      type: string;
      y_start_pct: number;
      y_end_pct: number;
    }>;
    return parsed.map((entry) => ({
      boundingBox: {
        x: 0,
        y: Math.round((entry.y_start_pct / 100) * pageHeight),
        width: 1440,
        height: Math.round(
          ((entry.y_end_pct - entry.y_start_pct) / 100) * pageHeight,
        ),
      },
      confidence: 0.75,
      source: "vision" as const,
      innerText: "",
      headingText: undefined,
      // Preserve the type the vision model identified — used to skip
      // the text-based classifier for candidates with no innerText.
      visionTag: entry.type !== "unknown" ? entry.type : undefined,
    }));
  } catch {
    // Vision unavailable — ladder proceeds with what it has; gap-fill covers
    // the rest.
    return [];
  }
}

type DomStyles = NonNullable<import("../../types/pipeline-artifacts").SegmentSection["domStyles"]>;
type DomStylesValues = import("../../types/pipeline-artifacts").DomStylesValues;

/**
 * Core DOM extraction logic run inside page.evaluate at a given viewport width.
 * The `vpWidth` is used to compute proportional content-width percentages.
 *
 * At 375px (mobile) we use a fixed center point and a fixed focus-Y near the top
 * of the viewport rather than re-mapping the 1440px bounding box coordinates,
 * because the layout reflowed and positions are unpredictable.
 */
async function extractStylesAtViewport(
  page: Page,
  bbox: { x: number; y: number; width: number; height: number },
  vpWidth: number,
): Promise<DomStylesValues> {
  const isMobile = vpWidth <= 400;
  return page.evaluate(
    ({ bx, by, bw, bh, mobile }: { bx: number; by: number; bw: number; bh: number; mobile: boolean }) => {
      // On mobile the section has likely reflowed and the 1440px bbox coords are
      // invalid.  Use a fixed sample point near the top of the visible content.
      let cx: number;
      let focusY: number;
      if (mobile) {
        cx = window.innerWidth / 2;
        focusY = 300; // reasonable "top of page content" point on mobile
        window.scrollTo({ top: 0, behavior: "instant" });
      } else {
        focusY = by + Math.min(bh / 3, 350);
        const targetScrollY = Math.max(0, focusY - window.innerHeight / 2);
        window.scrollTo({ top: targetScrollY, behavior: "instant" });
        cx = bx + bw / 2;
      }
      const cy = mobile ? focusY : focusY - window.scrollY;

      // Walk up from the center point to find the SECTION CONTAINER — a structural
      // element (div/section/article) that holds the heading + body + CTA together.
      // Skip heading and inline elements even if they're large enough; we need a
      // container that we can query for child elements.
      const LEAF_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','SPAN','A','BUTTON','IMG','VIDEO','SVG','BR']);
      let el: Element | null = document.elementFromPoint(cx, Math.max(1, cy));
      while (el && el !== document.body) {
        const r = el.getBoundingClientRect();
        const isContainer = !LEAF_TAGS.has(el.tagName);
        if (isContainer && (r.height >= (mobile ? 150 : bh * 0.5) || r.width >= window.innerWidth * 0.7)) break;
        el = el.parentElement;
      }
      if (!el || el === document.body) return {};
      // If the found element has no heading it's likely a background container.
      // Keep walking up to find the real content container that has the heading.
      if (!el.querySelector("h1,h2,h3")) {
        let p = el.parentElement;
        while (p && p !== document.body) {
          if (p.querySelector("h1,h2,h3")) { el = p; break; }
          p = p.parentElement;
        }
      }

      const s = getComputedStyle(el);
      const elWidth = el.getBoundingClientRect().width || window.innerWidth;

      // Detect overlay: positioned child with rgba dark background
      let overlayBackground: string | undefined;
      for (const child of Array.from(el.querySelectorAll("*"))) {
        const cs = getComputedStyle(child as Element);
        if (
          (cs.position === "absolute" || cs.position === "fixed") &&
          cs.backgroundColor.startsWith("rgba(0")
        ) {
          overlayBackground = cs.backgroundColor;
          break;
        }
      }

      // Primary heading — pick the heading with the LARGEST computed font-size.
      const hEl = Array.from(el.querySelectorAll("h1,h2,h3")).reduce(
        (best: Element | null, h) => {
          const sz = parseFloat(getComputedStyle(h).fontSize ?? "0");
          const bestSz = best ? parseFloat(getComputedStyle(best).fontSize ?? "0") : 0;
          return sz > bestSz ? h : best;
        }, null,
      );
      const hs = hEl ? getComputedStyle(hEl) : null;

      // CTA button — identified by DOM structure, not color.
      const CTA_CLASS_RE = /\b(btn|button|cta|action|primary|get.?started|sign.?up|join|enroll|book|schedule|free.?trial|start)\b/i;
      const isPhoneOrEmail = (href: string | null) => !!href && (href.startsWith("tel:") || href.startsWith("mailto:"));
      const candidates: { el: Element; score: number }[] = [];
      for (const btn of Array.from(el.querySelectorAll("a[href], button"))) {
        const rect = btn.getBoundingClientRect();
        if (rect.width < 50 || rect.height < 28) continue;
        const href = (btn as HTMLAnchorElement).getAttribute("href") ?? null;
        if (isPhoneOrEmail(href)) continue;
        const text = (btn as HTMLElement).textContent?.trim() ?? "";
        if (!text || text.length > 60) continue;
        const cls = (btn as HTMLElement).className ?? "";
        const classScore = CTA_CLASS_RE.test(cls) ? 10 : 0;
        const headingScore = hEl ? Math.max(0, 5 - Math.abs(btn.getBoundingClientRect().top - hEl.getBoundingClientRect().bottom) / 100) : 0;
        candidates.push({ el: btn, score: classScore + headingScore });
      }
      candidates.sort((a, b) => b.score - a.score);
      const ctaEl = candidates[0]?.el ?? null;
      const ctaS = ctaEl ? getComputedStyle(ctaEl) : null;

      let ctaPositionSide: "left" | "right" | "center" = "center";
      if (ctaEl && hEl) {
        const hr = hEl.getBoundingClientRect();
        const cr = (ctaEl as HTMLElement).getBoundingClientRect();
        if (cr.left > hr.right - 50) ctaPositionSide = "right";
        else if (cr.right < hr.left + 50) ctaPositionSide = "left";
      }

      const ctaLabel = ctaEl ? (ctaEl as HTMLElement).textContent?.trim() ?? undefined : undefined;
      const ctaHref = ctaEl ? (ctaEl as HTMLAnchorElement).getAttribute("href") ?? undefined : undefined;

      // Eyebrow: short text that appears BEFORE the main heading with a much smaller font.
      // Works for any framework: class-based selectors first, then structural detection
      // (headings before the main heading that are at least 50% smaller in font size).
      let eyebrowText: string | undefined;
      const mainHeadingSize = hEl ? parseFloat(getComputedStyle(hEl).fontSize) : 0;
      // 1. Class-based (explicit eyebrow/badge/etc classes)
      const classBased = el.querySelector("[class*='eyebrow'],[class*='badge'],[class*='label'],[class*='tag'],[class*='pill']");
      if (classBased) {
        const t = (classBased as HTMLElement).textContent?.trim() ?? "";
        if (t && t.length < 80 && t !== (hEl?.textContent?.trim() ?? "")) eyebrowText = t;
      }
      // 2. Structural: any heading before the main heading that is much smaller (eyebrow pattern)
      if (!eyebrowText && hEl) {
        const allHeadings = Array.from(el.querySelectorAll("h1,h2,h3,h4,h5,h6"));
        const mainIdx = allHeadings.indexOf(hEl);
        for (let i = mainIdx - 1; i >= 0; i--) {
          const h = allHeadings[i]!;
          const sz = parseFloat(getComputedStyle(h as Element).fontSize);
          const t = (h as HTMLElement).textContent?.trim() ?? "";
          if (t && t.length < 80 && sz < mainHeadingSize * 0.6) { eyebrowText = t; break; }
        }
      }

      // Body text: first body-like text element after the main heading.
      // Checks <p> and also <div> elements (some frameworks avoid <p> tags).
      // Text must be sentence-length (>20 chars) but not a long wall of text (<400 chars).
      let bodyText: string | undefined;
      if (hEl) {
        const headingBottom = hEl.getBoundingClientRect().bottom;
        const bodyCandidates = Array.from(el.querySelectorAll("p, div, span"))
          .filter(e => {
            // Skip links, buttons, or containers with interactive/heading children
            const tag = e.tagName;
            if (tag === 'A' || tag === 'BUTTON') return false;
            if (e.querySelector("a, button, h1, h2, h3, h4, input")) return false;
            const r = e.getBoundingClientRect();
            const t = (e as HTMLElement).textContent?.trim() ?? "";
            return r.top >= headingBottom - 10 && t.length > 30 && t.length < 400;
          });
        if (bodyCandidates[0]) {
          const t = (bodyCandidates[0] as HTMLElement).textContent?.trim() ?? "";
          bodyText = t.length > 300 ? t.slice(0, 300).trim() + "…" : t;
        }
      }

      // Content container width — find ancestor of heading that is narrower than section.
      let contentWidthPct: string | undefined;
      if (hEl) {
        let contentEl: Element | null = hEl.parentElement;
        while (contentEl && contentEl !== el) {
          const cr = contentEl.getBoundingClientRect();
          if (cr.width > 100 && cr.width < elWidth * 0.85) {
            contentWidthPct = `${Math.round(cr.width / elWidth * 100)}%`;
            break;
          }
          contentEl = contentEl.parentElement;
        }
      }

      const bgImg = s.backgroundImage;
      return {
        containerBackground: s.backgroundColor,
        containerBackgroundImage: bgImg !== "none" ? bgImg : undefined,
        overlayBackground,
        headingText: hEl ? (hEl as HTMLElement).textContent?.trim() || undefined : undefined,
        headingFontSize: hs?.fontSize,
        headingFontWeight: hs?.fontWeight,
        headingColor: hs?.color,
        headingTextTransform: hs?.textTransform !== "none" ? hs?.textTransform : undefined,
        ctaBackground: ctaS?.backgroundColor,
        ctaColor: ctaS?.color,
        ctaBorderRadius: ctaS?.borderRadius,
        ctaPositionSide: ctaEl ? ctaPositionSide : undefined,
        ctaLabel,
        ctaHref,
        eyebrowText,
        bodyText,
        contentWidthPct,
        flexDirection: s.flexDirection !== "row" ? s.flexDirection : undefined,
        textAlign: s.textAlign !== "start" && s.textAlign !== "left" ? s.textAlign : undefined,
        padding: s.padding !== "0px" ? s.padding : undefined,
      };
    },
    { bx: bbox.x, by: bbox.y, bw: bbox.width, bh: bbox.height, mobile: isMobile },
  );
}

/** Return only the keys in `next` that differ from `base` (omit identical values). */
function diffStyles(
  base: DomStylesValues,
  next: DomStylesValues,
): Partial<DomStylesValues> {
  const delta: Partial<DomStylesValues> = {};
  for (const _key of Object.keys(next) as Array<keyof DomStylesValues>) {
    const k = _key;
    if (next[k] !== base[k]) {
      // TypeScript needs an explicit cast here because the index signature types
      // aren't identical across all field types.
      (delta as Record<string, unknown>)[k] = next[k];
    }
  }
  return delta;
}

/**
 * Extract computed CSS values from the live DOM for a section's bounding box,
 * running the extraction at 375px, 768px, and 1440px viewports.
 *
 * Returns a mobile-first tiered structure: `base` (375px) always has all
 * values; `md` (768px) and `lg` (1440px) contain only the fields that changed
 * relative to the narrower tier, keeping the LLM prompt compact.
 *
 * The page viewport is restored to 1440px after all 3 runs.
 */
async function extractSectionDomStyles(
  page: Page,
  bbox: { x: number; y: number; width: number; height: number },
): Promise<DomStyles> {
  const viewports = [
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ] as const;

  try {
    const results: DomStylesValues[] = [];
    for (const vp of viewports) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      const styles = await extractStylesAtViewport(page, bbox, vp.width);
      results.push(styles);
    }
    // Restore to desktop viewport for the remainder of segment processing.
    await page.setViewportSize({ width: 1440, height: 900 });

    const [base, styles768, styles1440] = results as [DomStylesValues, DomStylesValues, DomStylesValues];
    return {
      base,
      md: diffStyles(base, styles768),
      lg: diffStyles(styles768, styles1440),
    };
  } catch {
    // Non-fatal — build stage falls back to screenshot interpretation.
    // Return an empty base tier so the schema still validates.
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
    return { base: {}, md: {}, lg: {} };
  }
}

function clampClip(
  box: { x: number; y: number; width: number; height: number },
  maxWidth: number,
  maxHeight: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(box.x, Math.max(0, maxWidth - 1)));
  const y = Math.max(0, Math.min(box.y, Math.max(0, maxHeight - 1)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(box.width, maxWidth - x)),
    height: Math.max(1, Math.min(box.height, maxHeight - y)),
  };
}

function mediaInBox(
  media: ExtractArtifact["pages"][number]["media"],
  _box: { y: number; height: number },
): string[] {
  // Network capture has no position info; return image/video URLs page-wide.
  // Position attribution happens naturally because the crop shows the actual
  // imagery.
  return media
    .filter((m) => m.resourceType === "image" || m.resourceType === "video")
    .map((m) => m.url);
}

function interactionsInBox(
  interactions: ExtractArtifact["pages"][number]["interactions"],
  box: { y: number; height: number },
): string[] {
  return interactions
    .filter(
      (i) =>
        i.boundingBox.y >= box.y &&
        i.boundingBox.y < box.y + box.height,
    )
    .map((i) => i.id);
}
