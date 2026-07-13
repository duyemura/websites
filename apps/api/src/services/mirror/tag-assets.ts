import { chatCompletion } from "../../ai/llm-client.js";
import {
  loadScrapedAssetVisionTemplate,
  parseScrapedAssetVisionResponse,
  type ScrapedAssetVisionResult,
} from "../../ai/prompts/scraped-asset-vision.js";

export interface VisionConfig {
  LLM_PROVIDER: "openrouter" | "ollama";
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL: string;
  OLLAMA_API_KEY?: string;
  OLLAMA_BASE_URL: string;
  VISION_LLM_MODEL: string;
}

const MAX_CONCURRENT_VISION = 6;
const MIN_PHOTO_BYTES = 15 * 1024;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);

function isPhotoAsset(contentType: string, byteLength: number): boolean {
  return PHOTO_CONTENT_TYPES.has(contentType.toLowerCase())
    && byteLength >= MIN_PHOTO_BYTES
    && byteLength <= MAX_PHOTO_BYTES;
}

function dataUriFromBuffer(buffer: Buffer, contentType: string): string {
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export async function tagAsset(
  buffer: Buffer,
  contentType: string,
  config: VisionConfig,
): Promise<ScrapedAssetVisionResult | undefined> {
  const prompt = loadScrapedAssetVisionTemplate();
  const dataUri = dataUriFromBuffer(buffer, contentType);

  const response = await chatCompletion(
    {
      model: config.VISION_LLM_MODEL,
      temperature: 0,
      maxTokens: 250,
      jsonMode: true,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
    },
    config as unknown as import("../../plugins/env.js").Config,
  );

  const raw = response.content?.trim() ?? "";
  if (!raw) return undefined;

  const parsed = parseScrapedAssetVisionResponse(raw);
  if (!parsed.success) return undefined;

  return parsed.data;
}

interface AssetDownload {
  url: string;
  buffer: Buffer;
  contentType: string;
}

export interface TaggerLog {
  info: (o: object, m: string) => void;
  warn: (o: object, m: string) => void;
}

export async function tagPhotoAssets(
  downloads: AssetDownload[],
  config: VisionConfig | undefined,
  log?: TaggerLog,
): Promise<Map<string, ScrapedAssetVisionResult>> {
  const results = new Map<string, ScrapedAssetVisionResult>();
  if (!config) return results;

  const photos = downloads.filter((d) => isPhotoAsset(d.contentType, d.buffer.byteLength));
  if (photos.length === 0) return results;

  log?.info({ count: photos.length }, "vision-tagging scraped photo assets");

  let completed = 0;
  let failed = 0;

  async function tagOne(download: AssetDownload) {
    try {
      const result = await tagAsset(download.buffer, download.contentType, config!);
      if (result) {
        results.set(download.url, result);
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      log?.warn(
        { url: download.url, err: err instanceof Error ? err.message : String(err) },
        "vision tag failed for asset",
      );
    } finally {
      completed += 1;
      if (completed % 10 === 0 || completed === photos.length) {
        log?.info({ completed, failed, total: photos.length }, "vision tagging progress");
      }
    }
  }

  // Bounded concurrency pool
  const queue = [...photos];
  const active: Promise<void>[] = [];
  while (queue.length > 0 || active.length > 0) {
    while (active.length < MAX_CONCURRENT_VISION && queue.length > 0) {
      const item = queue.shift() as AssetDownload;
      const p = tagOne(item).finally(() => {
        const i = active.indexOf(p);
        if (i >= 0) active.splice(i, 1);
      });
      active.push(p);
    }
    if (active.length > 0) await Promise.race(active);
  }

  log?.info({ tagged: results.size, failed, total: photos.length }, "vision tagging complete");
  return results;
}
