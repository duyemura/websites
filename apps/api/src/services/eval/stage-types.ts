// apps/api/src/services/eval/stage-types.ts
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";

export interface StageContext {
  db: Kysely<DB>;
  config: Config;
  s3Client: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  /** Absolute path to apps/renderer */
  rendererDir: string;
  verbose: boolean;
  log: (msg: string) => void;
  /** "free" = 20 structural pages (default), "paid" = unlimited */
  tier: "free" | "paid";
  /** Override the Astro template theme. Defaults to auto-detected baseline/impact. */
  templateTheme?: "baseline" | "impact" | "beanburito";
  /**
   * When set, content stage only processes these page paths and merges
   * the resulting briefs into the existing content artifact. Used by `milo page`.
   */
  pageFilter?: string[];
}

export interface StageResult {
  stage: string;
  status: "pass" | "warn" | "fail" | "skipped";
  durationMs: number;
  metrics: Record<string, number | string | boolean>;
  warnings: string[];
  error?: string;
  /** Estimated resource costs for this stage */
  costs?: StageCosts;
}

export interface StageCosts {
  s3Puts: number;
  s3Gets: number;
  s3BytesUploaded: number;
  /** Estimated one-time cost in USD (S3 requests) */
  estimatedUsd: number;
  /** Estimated monthly storage cost in USD */
  monthlyStorageUsd: number;
}

/** Valid artifact keys accepted by loadArtifact. Empty string ("") means stage produces no artifact and will always re-run. */
export type ArtifactKey = string;

export interface StageRunner {
  label: string;
  requires: ArtifactKey[];
  /** Primary artifact key this stage produces. Empty string ("") means stage produces no artifact and will always re-run. */
  produces: ArtifactKey;
  run(ctx: StageContext): Promise<StageResult>;
}

/**
 * Deduplicate warnings by grouping identical message patterns.
 * "/page: Elementor warning" × 809 → "Elementor warning (809 pages)"
 */
export function dedupeWarnings(warnings: string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of warnings) {
    const match = w.match(/^[^:]+:\s*(.+)$/);
    const key = (match?.[1] ?? w).slice(0, 100);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([msg, count]) =>
    count > 1 ? `${msg} (${count} pages)` : msg,
  );
}

/** Estimate S3 costs for a mirror stage based on page and asset counts. */
export function estimateMirrorCosts(pages: number, assets: number): StageCosts {
  const AVG_HTML_BYTES = 50_000;
  const AVG_ASSET_BYTES = 200_000;
  const s3Puts = pages * 3 + assets;
  const s3Gets = pages;
  const s3BytesUploaded = pages * AVG_HTML_BYTES * 3 + assets * AVG_ASSET_BYTES;
  const PUT_COST_PER_1K = 0.005;
  const GET_COST_PER_1K = 0.0004;
  const STORAGE_USD_PER_GB_MONTH = 0.023;
  const estimatedUsd = (s3Puts / 1000) * PUT_COST_PER_1K + (s3Gets / 1000) * GET_COST_PER_1K;
  const monthlyStorageUsd = (s3BytesUploaded / (1024 ** 3)) * STORAGE_USD_PER_GB_MONTH;
  return { s3Puts, s3Gets, s3BytesUploaded, estimatedUsd, monthlyStorageUsd };
}
