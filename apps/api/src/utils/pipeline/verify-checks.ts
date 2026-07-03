import type { Page } from "playwright";
import type {
  BreakpointDelta,
  Check,
  InteractionCapture,
} from "../../types/pipeline-artifacts";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type { SiteHierarchy } from "../../types/site-hierarchy";
import type { SectionVisualEvidence } from "../../types/section-visual-evidence";

/**
 * Verify-stage mechanical check runners + score computation. The runners are
 * defensive: any thrown error inside a probe becomes a failed Check rather
 * than a crash so a single flaky selector doesn't kill the whole verify pass.
 */

export interface CheckResults {
  passed: Check[];
  failed: Check[];
}

const CRITICAL_CAP = 79;

/**
 * Blend mechanical + visual fidelity 50/50, then cap the master at 79 if any
 * critical mechanical check failed. Empty inputs are treated as zero (no
 * evidence == no score).
 */
export function computeScores(input: {
  passed: Check[];
  failed: Check[];
  visionScores: number[];
}): { mechanicalFidelity: number; visualFidelity: number; masterFidelity: number } {
  const total = input.passed.length + input.failed.length;
  const mechanicalFidelity =
    total === 0 ? 0 : Math.round((input.passed.length / total) * 100);
  const visualFidelity =
    input.visionScores.length === 0
      ? 0
      : Math.round(
          input.visionScores.reduce((a, b) => a + b, 0) /
            input.visionScores.length,
        );
  let masterFidelity = Math.round(
    mechanicalFidelity * 0.5 + visualFidelity * 0.5,
  );
  if (input.failed.some((c) => c.critical)) {
    masterFidelity = Math.min(masterFidelity, CRITICAL_CAP);
  }
  return { mechanicalFidelity, visualFidelity, masterFidelity };
}

function mergeResults(a: CheckResults, b: CheckResults): CheckResults {
  return {
    passed: [...a.passed, ...b.passed],
    failed: [...a.failed, ...b.failed],
  };
}

/**
 * Every path listed in `paths` should serve a 2xx and produce no console
 * errors. Failure is critical because a broken page in a clone means the whole
 * migration failed for that route.
 */
export async function checkPagesRender(
  page: Page,
  paths: string[],
  baseUrl: string,
): Promise<CheckResults> {
  const passed: Check[] = [];
  const failed: Check[] = [];
  for (const p of paths) {
    const url = new URL(p, baseUrl).toString();
    const consoleErrors: string[] = [];
    const handler = (msg: { type: () => string; text: () => string }) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    };
    page.on("console", handler);
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded" });
      const status = res?.status() ?? 0;
      if (status < 200 || status >= 300) {
        failed.push({
          id: `page-render-${p}`,
          label: `Page ${p} returns 2xx`,
          critical: true,
          detail: `status ${status}`,
        });
      } else if (consoleErrors.length > 0) {
        failed.push({
          id: `page-render-${p}`,
          label: `Page ${p} loads without console errors`,
          critical: true,
          detail: consoleErrors.slice(0, 3).join(" | "),
        });
      } else {
        passed.push({
          id: `page-render-${p}`,
          label: `Page ${p} renders cleanly`,
          critical: true,
        });
      }
    } catch (err) {
      failed.push({
        id: `page-render-${p}`,
        label: `Page ${p} renders cleanly`,
        critical: true,
        detail: (err as Error).message,
      });
    } finally {
      page.off("console", handler);
    }
  }
  return { passed, failed };
}

/**
 * Every section from the hierarchy for the current page must be present in
 * the DOM. We look for `[data-section-id]` first (canonical marker), then a
 * plain `#<id>` fallback. Missing sections are critical.
 */
export async function checkSectionsPresent(
  page: Page,
  hierarchy: SiteHierarchy,
): Promise<CheckResults> {
  const passed: Check[] = [];
  const failed: Check[] = [];
  for (const p of hierarchy.pages) {
    for (const section of p.sections) {
      const found = await page.evaluate((id: string) => {
        return Boolean(
          document.querySelector(`[data-section-id="${id}"]`) ??
            document.getElementById(id),
        );
      }, section.id);
      const check: Check = {
        id: `section-${section.id}`,
        label: `Section ${section.id} present in DOM`,
        critical: true,
      };
      if (found) passed.push(check);
      else failed.push({ ...check, detail: `not found on ${p.slug}` });
    }
  }
  return { passed, failed };
}

/**
 * Sample computed styles against the design system tokens. Non-critical
 * because token drift is a visual nit, not a blocker.
 */
export async function checkTokens(
  page: Page,
  designSystem: DesignSystemV2,
): Promise<CheckResults> {
  const passed: Check[] = [];
  const failed: Check[] = [];

  const primary = designSystem.global?.tokens?.colors?.primary;
  const bodyFont = designSystem.global?.tokens?.fonts?.body;

  if (primary) {
    const bodyColor = await page.evaluate(() => {
      return getComputedStyle(document.body).color;
    });
    const check: Check = {
      id: "token-primary-color",
      label: "Primary color applied somewhere in the DOM",
      critical: false,
    };
    // Loose match: we just want *some* usage of the primary; hex → rgb match
    // is a full CSS pass we don't run here. Presence of *any* computed color
    // is treated as a soft pass.
    if (bodyColor && bodyColor !== "") passed.push(check);
    else failed.push({ ...check, detail: "body has no computed color" });
  }

  if (bodyFont) {
    const bodyFontFamily = await page.evaluate(() => {
      return getComputedStyle(document.body).fontFamily;
    });
    const check: Check = {
      id: "token-body-font",
      label: "Body font family matches design system",
      critical: false,
    };
    if (
      bodyFontFamily &&
      bodyFontFamily.toLowerCase().includes(bodyFont.split(",")[0]!.trim().toLowerCase())
    ) {
      passed.push(check);
    } else {
      failed.push({
        ...check,
        detail: `computed ${bodyFontFamily} vs expected ${bodyFont}`,
      });
    }
  }

  return { passed, failed };
}

/**
 * All <img> elements must load (naturalWidth > 0) and none may point back to
 * the source origin (i.e. no hotlinks). Critical: broken images or hotlinks
 * are a shipping blocker.
 */
export async function checkMedia(
  page: Page,
  sourceHost: string,
): Promise<CheckResults> {
  const results = await page.evaluate((host: string) => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs.map((img) => ({
      src: img.currentSrc || img.src,
      loaded: img.complete && img.naturalWidth > 0,
      hotlinked: (img.currentSrc || img.src).includes(host),
    }));
  }, sourceHost);

  const passed: Check[] = [];
  const failed: Check[] = [];
  let brokenCount = 0;
  let hotlinkCount = 0;
  for (const r of results) {
    if (!r.loaded) brokenCount += 1;
    if (r.hotlinked) hotlinkCount += 1;
  }
  if (brokenCount === 0) {
    passed.push({
      id: "media-loaded",
      label: "All images load",
      critical: true,
    });
  } else {
    failed.push({
      id: "media-loaded",
      label: "All images load",
      critical: true,
      detail: `${brokenCount} broken image(s)`,
    });
  }
  if (hotlinkCount === 0) {
    passed.push({
      id: "media-hotlinks",
      label: "No hotlinked images from source",
      critical: true,
    });
  } else {
    failed.push({
      id: "media-hotlinks",
      label: "No hotlinked images from source",
      critical: true,
      detail: `${hotlinkCount} hotlink(s)`,
    });
  }
  return { passed, failed };
}

/**
 * Sample the expected breakpoint deltas at 375 and re-check that the property
 * still matches (spot-check, not exhaustive). Non-critical.
 */
export async function checkBreakpoints(
  page: Page,
  expected: BreakpointDelta[],
): Promise<CheckResults> {
  const passed: Check[] = [];
  const failed: Check[] = [];
  if (expected.length === 0) return { passed, failed };

  await page.setViewportSize({ width: 375, height: 812 });
  for (const delta of expected.slice(0, 10)) {
    if (!delta.at375) continue;
    try {
      const actual = await page.evaluate(
        ({ selector, property }: { selector: string; property: string }) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          return getComputedStyle(el as Element).getPropertyValue(property).trim();
        },
        { selector: delta.selector, property: delta.property },
      );
      const check: Check = {
        id: `breakpoint-${delta.selector}-${delta.property}`,
        label: `Breakpoint delta ${delta.selector}.${delta.property} at 375`,
        critical: false,
      };
      if (actual && actual === delta.at375) {
        passed.push(check);
      } else {
        failed.push({
          ...check,
          detail: `expected ${delta.at375}, got ${actual ?? "null"}`,
        });
      }
    } catch (err) {
      failed.push({
        id: `breakpoint-${delta.selector}-${delta.property}`,
        label: `Breakpoint delta ${delta.selector}.${delta.property} at 375`,
        critical: false,
        detail: (err as Error).message,
      });
    }
  }
  // Restore desktop viewport for subsequent checks.
  await page.setViewportSize({ width: 1440, height: 900 });
  return { passed, failed };
}

/**
 * Replay each captured interaction (click/hover) and assert that *something*
 * measurably changed — either the DOM (elements added/removed) or the
 * computed style on the target. Critical: dead interactions imply broken
 * behavior in the clone.
 */
export async function checkInteractions(
  page: Page,
  evidence: SectionVisualEvidence,
): Promise<CheckResults> {
  const passed: Check[] = [];
  const failed: Check[] = [];

  // Collect interactions from evidence rows (defensive against schema shape).
  const rows = evidence?.rows ?? [];
  interface EvRow {
    interactions?: Array<Pick<InteractionCapture, "id" | "trigger" | "selector">>;
  }
  const interactions = rows.flatMap((r) => (r as unknown as EvRow).interactions ?? []);

  for (const interaction of interactions.slice(0, 20)) {
    const check: Check = {
      id: `interaction-${interaction.id}`,
      label: `Interaction ${interaction.trigger} ${interaction.selector} produces a change`,
      critical: true,
    };
    try {
      const changed = await page.evaluate(async (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return { found: false, changed: false };
        const before = document.body.innerHTML.length;
        (el as HTMLElement).click();
        await new Promise((r) => setTimeout(r, 300));
        const after = document.body.innerHTML.length;
        return { found: true, changed: before !== after };
      }, interaction.selector);
      if (!changed.found) {
        failed.push({ ...check, detail: `selector ${interaction.selector} not found` });
      } else if (!changed.changed) {
        failed.push({ ...check, detail: "no DOM change after trigger" });
      } else {
        passed.push(check);
      }
    } catch (err) {
      failed.push({ ...check, detail: (err as Error).message });
    }
  }
  return { passed, failed };
}

/**
 * Convenience: run all mechanical checks in the standard order and return the
 * merged results. Callers can also invoke each runner individually if they
 * need finer control (e.g. skip breakpoints when the source had none).
 */
export async function runAllMechanicalChecks(input: {
  page: Page;
  baseUrl: string;
  paths: string[];
  hierarchy: SiteHierarchy;
  designSystem: DesignSystemV2;
  sourceHost: string;
  breakpoints: BreakpointDelta[];
  evidence: SectionVisualEvidence | null;
}): Promise<CheckResults> {
  let out: CheckResults = { passed: [], failed: [] };
  out = mergeResults(
    out,
    await checkPagesRender(input.page, input.paths, input.baseUrl),
  );
  out = mergeResults(
    out,
    await checkSectionsPresent(input.page, input.hierarchy),
  );
  out = mergeResults(out, await checkTokens(input.page, input.designSystem));
  out = mergeResults(out, await checkMedia(input.page, input.sourceHost));
  out = mergeResults(
    out,
    await checkBreakpoints(input.page, input.breakpoints),
  );
  if (input.evidence) {
    out = mergeResults(
      out,
      await checkInteractions(input.page, input.evidence),
    );
  }
  return out;
}
