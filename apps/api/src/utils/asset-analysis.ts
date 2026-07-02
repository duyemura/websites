import { type Kysely, sql } from "kysely";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { FastifyBaseLogger } from "fastify";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import { getS3Client } from "../s3";
import { callLlmAndLog, type LlmCallContext } from "../ai/llm-with-logging";
import {
  extractImageMetadata,
  prepareImageForVision,
  bufferToDataUrl,
  type ExtractedImageMetadata,
} from "./extract-image-metadata";
import {
  loadAssetAnalysisTemplate,
  parseAssetAnalysisResponse,
  formatAssetAnalysisParseError,
  type AssetAnalysisResult,
} from "../ai/prompts/asset-analysis";

export const CURRENT_ANALYSIS_VERSION = 1;

export interface AnalysisOutput {
  analyzedAt: string;
  model: string;
  version: number;
  description: string;
  altText: string;
  context: AssetAnalysisResult["context"];
  confidence: number;
  tags: string[];
  technical: AssetAnalysisResult["technical"];
  quality: AssetAnalysisResult["quality"];
  marketing: AssetAnalysisResult["marketing"];
  safety: AssetAnalysisResult["safety"];
  technicalLocal?: ExtractedImageMetadata;
}

export interface AssetAnalysis {
  analysis: AnalysisOutput;
  dimensions?: { width?: number; height?: number };
  fileSize?: number;
  exif?: Record<string, unknown>;
  technicalLocal?: ExtractedImageMetadata;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchAssetBuffer(
  config: Config,
  storageKey: string,
  log?: FastifyBaseLogger,
): Promise<Buffer | null> {
  const s3 = getS3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  });

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: config.S3_ASSETS_BUCKET,
        Key: storageKey,
      }),
    );
    if (!response.Body) return null;
    return streamToBuffer(response.Body as NodeJS.ReadableStream);
  } catch (err) {
    log?.warn({ err, storageKey }, "Failed to fetch asset buffer from S3");
    return null;
  }
}

export function isAnalyzableImage(
  type: string,
  mimeType: string | null | undefined,
): boolean {
  return type === "image" || mimeType?.startsWith("image/") || false;
}

async function acquireAssetAnalysisLock(
  db: Kysely<DB>,
  assetUuid: string,
): Promise<void> {
  await sql`select pg_advisory_xact_lock(('x' || substr(md5(${assetUuid}), 1, 16))::bit(64)::bigint)`.execute(
    db,
  );
}

export interface AnalyzeAssetInput {
  db: Kysely<DB>;
  config: Config;
  workspaceUuid: string;
  assetUuid: string;
  userUuid: string;
  siteUuid?: string | null;
  aiJobUuid?: string | null;
  log?: FastifyBaseLogger;
}

export async function analyzeAsset(input: AnalyzeAssetInput): Promise<void> {
  const { db, config, workspaceUuid, assetUuid, userUuid, siteUuid, aiJobUuid, log } =
    input;

  // Serialize per-asset analysis to prevent concurrent vision-LLM calls for the
  // same asset. The advisory lock is transaction-scoped, so the entire body is
  // wrapped in a transaction; the lock is released on commit/rollback.
  try {
    await db.transaction().execute(async (trx) => {
      try {
        await acquireAssetAnalysisLock(trx, assetUuid);

        const asset = await trx
        .selectFrom("assets")
        .select(["uuid", "type", "source", "mimeType", "storageKey", "metadata"])
        .where("uuid", "=", assetUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!asset) return;
      if (asset.source === "screenshot") return;
      if (!isAnalyzableImage(asset.type, asset.mimeType)) return;

      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      const existingAnalysis = metadata.analysis as
        | { version?: number; analyzedAt?: string }
        | undefined;
      if (
        existingAnalysis &&
        existingAnalysis.version &&
        existingAnalysis.version >= CURRENT_ANALYSIS_VERSION
      ) {
        return;
      }

      const buffer = await fetchAssetBuffer(config, asset.storageKey, log);
      if (!buffer) return;

      const localMetadata = await extractImageMetadata(
        buffer,
        asset.mimeType ?? undefined,
      );

      const llmResult: AssetAnalysisResult | null = localMetadata.format
        ? await runVisionAnalysis(buffer, asset.mimeType ?? undefined, {
            db: trx,
            config,
            workspaceUuid,
            userUuid,
            siteUuid,
            aiJobUuid,
          })
        : null;

      const analysis: AnalysisOutput | undefined = llmResult
        ? {
            analyzedAt: new Date().toISOString(),
            model: config.VISION_LLM_MODEL,
            version: CURRENT_ANALYSIS_VERSION,
            description: llmResult.description,
            altText: llmResult.altText,
            context: llmResult.context,
            confidence: llmResult.confidence,
            tags: llmResult.tags,
            technical: llmResult.technical,
            quality: llmResult.quality,
            marketing: llmResult.marketing,
            safety: llmResult.safety,
            technicalLocal: localMetadata,
          }
        : undefined;

      const updatedMetadata: Record<string, unknown> = {
        ...metadata,
        dimensions: {
          width: localMetadata.width,
          height: localMetadata.height,
        },
        fileSize: localMetadata.fileSize,
        exif: localMetadata.exif,
        technicalLocal: {
          format: localMetadata.format,
          hasTransparency: localMetadata.hasTransparency,
          hasAnimation: localMetadata.hasAnimation,
          channels: localMetadata.channels,
          depth: localMetadata.depth,
          density: localMetadata.density,
          orientation: localMetadata.orientation,
          dominantColors: localMetadata.dominantColors,
        },
        ...(analysis ? { analysis } : {}),
      };

      // Conditional update prevents a slow vision call from overwriting analysis
      // produced by a faster concurrent worker that finished while this one ran.
      await trx
        .updateTable("assets")
        .set({ metadata: updatedMetadata as import("../types/db").Json })
        .where("uuid", "=", assetUuid)
        .where(
          sql<boolean>`metadata is null or not (metadata @> ${sql.lit(
            JSON.stringify({ analysis: {} }),
          )}) or coalesce((metadata -> 'analysis' ->> 'version')::int, 0) < ${CURRENT_ANALYSIS_VERSION}`,
        )
        .execute();
      } catch (inner) {
        log?.warn(
          { err: inner, assetUuid },
          "analyzeAsset first transactional query failed",
        );
        throw inner;
      }
    });
  } catch (error) {
    log?.warn({ err: error, assetUuid }, "analyzeAsset transaction failed");
    throw error;
  }
}

interface VisionContext extends LlmCallContext {
  config: Config;
}

async function runVisionAnalysis(
  buffer: Buffer,
  mimeType: string | undefined,
  ctx: VisionContext,
): Promise<AssetAnalysisResult | null> {
  const prepared = await prepareImageForVision(buffer, mimeType);
  const dataUrl = bufferToDataUrl(prepared.buffer, prepared.mimeType);
  const template = loadAssetAnalysisTemplate();

  const { response, outcome } = await callLlmAndLog(
    {
      db: ctx.db,
      workspaceUuid: ctx.workspaceUuid,
      userUuid: ctx.userUuid,
      siteUuid: ctx.siteUuid ?? null,
      aiJobUuid: ctx.aiJobUuid ?? null,
    },
    {
      agent: "asset-curator",
      actionType: "analyze",
      promptTemplateKeys: ["asset-analysis"],
      summary: "Analyze and classify a workspace asset with vision LLM",
      messages: [
        { role: "system", content: template },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this asset and return the JSON object described above." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.3,
      maxTokens: 1500,
      jsonMode: true,
      postCall: (response) => {
        if (!response.content.trim()) {
          return {
            outcome: "partial",
            errorMessage: "Empty response from asset analysis LLM",
            summary: "Asset analysis returned empty content",
          };
        }
        const parse = parseAssetAnalysisResponse(response.content);
        if (!parse.success) {
          return {
            outcome: "partial",
            errorMessage: formatAssetAnalysisParseError(response.content, parse),
            summary: "Asset analysis response failed schema validation",
          };
        }
        return undefined;
      },
    },
    ctx.config,
  );

  if (outcome === "failure") {
    return null;
  }

  const parse = parseAssetAnalysisResponse(response.content);
  return parse.success ? parse.data : null;
}
