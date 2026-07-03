import type { Page } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";

export interface AxeBaselineResult {
  path: string;
  violations: Array<{ id: string; impact: string; nodes: number }>;
}

export async function runAxeBaseline(
  page: Page,
  path: string,
): Promise<AxeBaselineResult> {
  const results = await new AxeBuilder({ page }).analyze();
  return {
    path,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      nodes: v.nodes.length,
    })),
  };
}

export interface NetworkStats {
  path: string;
  totalBytes: number;
  requestCount: number;
  imageBytes: number;
}

export function networkStatsFromCapture(
  path: string,
  stats: { totalBytes: number; requestCount: number; imageBytes: number },
): NetworkStats {
  return { path, ...stats };
}

export interface LighthouseResult {
  path: string;
  preset: "mobile" | "desktop";
  performance: number;
  seo: number;
  accessibility: number;
  bestPractices: number;
}

// Lighthouse needs a Chrome instance with a remote-debugging port. The extract stage
// launches its browser with `--remote-debugging-port=0` and passes the resolved port here.
export async function runLighthouse(
  url: string,
  path: string,
  preset: "mobile" | "desktop",
  debugPort: number,
): Promise<LighthouseResult | null> {
  try {
    const { default: lighthouse } = await import("lighthouse");
    const result = await lighthouse(url, {
      port: debugPort,
      output: "json",
      formFactor: preset,
      screenEmulation:
        preset === "mobile"
          ? {
              mobile: true,
              width: 375,
              height: 812,
              deviceScaleFactor: 2,
              disabled: false,
            }
          : {
              mobile: false,
              width: 1440,
              height: 900,
              deviceScaleFactor: 1,
              disabled: false,
            },
      onlyCategories: ["performance", "seo", "accessibility", "best-practices"],
    });
    const cats = result?.lhr.categories;
    if (!cats) return null;
    const pct = (s: number | null | undefined) => Math.round((s ?? 0) * 100);
    return {
      path,
      preset,
      performance: pct(cats.performance?.score),
      seo: pct(cats.seo?.score),
      accessibility: pct(cats.accessibility?.score),
      bestPractices: pct(cats["best-practices"]?.score),
    };
  } catch {
    // baseline is best-effort; a null entry is recorded as "lighthouse unavailable"
    return null;
  }
}
