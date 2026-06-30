import type { Kysely } from "kysely";
import { GetObjectCommand } from "@aws-sdk/client-s3";
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
}

export interface AssetAnalysis {
  analysis: AnalysisOutput;
  dimensions?: { width?: number; height?: number };
  fileSize?: number;
  exif?: { base64?: string };
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
  } catch {
    return null;
  }
}

export interface AnalyzeAssetInput {
  db: Kysely<DB>;
  config: Config;
  workspaceUuid: string;
  assetUuid: string;
  userUuid: string;
  siteUuid?: string | null;
  aiJobUuid?: string | null;
}

export async function analyzeAsset(input: AnalyzeAssetInput): Promise<void> {
  const { db, config, workspaceUuid, assetUuid, userUuid, siteUuid, aiJobUuid } = input;

  const asset = await db
    .selectFrom("assets")
    .select(["uuid", "type", "source", "mimeType", "storageKey", "metadata"])
    .where("uuid", "=", assetUuid)
    .where("workspaceUuid", "=", workspaceUuid)
    .executeTakeFirst();

  if (!asset) return;
  if (asset.source === "screenshot") return;

  const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
  const existingAnalysis = metadata.analysis as
    | { version?: number; analyzedAt?: string }
    | undefined;
  if (existingAnalysis && existingAnalysis.version && existingAnalysis.version >= CURRENT_ANALYSIS_VERSION) {
    return;
  }

  const buffer = await fetchAssetBuffer(config, asset.storageKey);
  if (!buffer) return;

  let localMetadata: ExtractedImageMetadata | undefined;
  if (asset.type === "image" || asset.mimeType?.startsWith("image/")) {
    localMetadata = await extractImageMetadata(buffer);
  }

  const llmResult: AssetAnalysisResult | null =
    asset.type === "image" || asset.mimeType?.startsWith("image/")
      ? await runVisionAnalysis(buffer, {
          db,
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
      }
    : undefined;

  const updatedMetadata: Record<string, unknown> = {
    ...metadata,
    ...(localMetadata
      ? {
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
        }
      : {}),
    ...(analysis ? { analysis } : {}),
  };

  await db
    .updateTable("assets")
    .set({ metadata: updatedMetadata as import("../types/db").Json })
    .where("uuid", "=", assetUuid)
    .execute();
}

interface VisionContext extends LlmCallContext {
  config: Config;
}

async function runVisionAnalysis(
  buffer: Buffer,
  ctx: VisionContext,
): Promise<AssetAnalysisResult | null> {
  const prepared = await prepareImageForVision(buffer);
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
