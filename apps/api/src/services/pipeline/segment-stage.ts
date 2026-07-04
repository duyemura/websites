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

/**
 * Extract computed CSS values from the live DOM for a section's bounding box.
 * Returns exact values (colors, font weights, overlay opacity, CTA position)
 * so the build stage LLM converts data → code rather than guessing from screenshots.
 */
async function extractSectionDomStyles(
  page: Page,
  bbox: { x: number; y: number; width: number; height: number },
): Promise<DomStyles> {
  try {
    await page.evaluate((y: number) => window.scrollTo(0, y), Math.max(0, bbox.y - 100));
    await page.waitForTimeout(80);

    return await page.evaluate(
      ({ bx, by, bw, bh }: { bx: number; by: number; bw: number; bh: number }) => {
        const cx = bx + bw / 2;
        const cy = by + bh / 2 - window.scrollY;

        // Walk up from the center point to find the section container
        let el: Element | null = document.elementFromPoint(cx, Math.max(1, cy));
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.height >= bh * 0.5 || r.width >= bw * 0.7) break;
          el = el.parentElement;
        }
        if (!el || el === document.body) return {};

        const s = getComputedStyle(el);

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

        // Primary heading
        const hEl = el.querySelector("h1, h2, h3");
        const hs = hEl ? getComputedStyle(hEl) : null;

        // CTA button — most saturated background color among visible buttons/links
        const rgbSat = (rgb: string): number => {
          const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!m) return 0;
          const r = +(m[1]!) / 255, g = +(m[2]!) / 255, b = +(m[3]!) / 255;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const l = (max + min) / 2;
          return max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
        };
        let ctaEl: Element | null = null, bestSat = 0.15;
        for (const btn of Array.from(el.querySelectorAll("a, button"))) {
          const r = btn.getBoundingClientRect();
          if (r.width < 40 || r.height < 24) continue;
          const bg = getComputedStyle(btn as Element).backgroundColor;
          const sat = rgbSat(bg);
          if (sat > bestSat) { bestSat = sat; ctaEl = btn; }
        }
        const ctaS = ctaEl ? getComputedStyle(ctaEl) : null;

        let ctaPositionSide: "left" | "right" | "center" = "center";
        if (ctaEl && hEl) {
          const hr = hEl.getBoundingClientRect();
          const cr = (ctaEl as HTMLElement).getBoundingClientRect();
          if (cr.left > hr.right - 50) ctaPositionSide = "right";
          else if (cr.right < hr.left + 50) ctaPositionSide = "left";
        }

        // CTA label and href — extracted from the same element we found by saturation
        const ctaLabel = ctaEl ? (ctaEl as HTMLElement).textContent?.trim() ?? undefined : undefined;
        const ctaHref = ctaEl ? (ctaEl as HTMLAnchorElement).getAttribute("href") ?? undefined : undefined;

        // Eyebrow: small uppercase text near the top of the section, often in a badge/pill
        let eyebrowText: string | undefined;
        const eyebrowCandidates = [
          el.querySelector("[class*='eyebrow'],[class*='badge'],[class*='label'],[class*='tag'],[class*='pill']"),
          el.querySelector("p + h1, p + h2"), // <p> before a heading is often an eyebrow
        ];
        for (const ec of eyebrowCandidates) {
          if (!ec) continue;
          const t = (ec as HTMLElement).textContent?.trim() ?? "";
          // Eyebrows are short (< 60 chars) and appear before the main heading
          if (t && t.length < 60 && t !== (hEl?.textContent?.trim() ?? "")) {
            eyebrowText = t;
            break;
          }
        }

        const bgImg = s.backgroundImage;
        return {
          containerBackground: s.backgroundColor,
          containerBackgroundImage: bgImg !== "none" ? bgImg : undefined,
          overlayBackground,
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
          flexDirection: s.flexDirection !== "row" ? s.flexDirection : undefined,
          textAlign: s.textAlign !== "start" && s.textAlign !== "left" ? s.textAlign : undefined,
          padding: s.padding !== "0px" ? s.padding : undefined,
        };
      },
      { bx: bbox.x, by: bbox.y, bw: bbox.width, bh: bbox.height },
    );
  } catch {
    return {}; // non-fatal — build stage falls back to screenshot interpretation
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
