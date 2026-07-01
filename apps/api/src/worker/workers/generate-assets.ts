import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";
import { analyzeAsset } from "../../utils/asset-analysis";
import { selectReferenceAssets } from "../../utils/asset-reference-picker";
import { verifyGeneratedAsset } from "../../utils/asset-generation-verifier";
import { buildImageGenerationPrompt } from "../../ai/prompts/asset-generation";
import { createImageProvider } from "../../ai/image-providers";
import { uploadBufferToS3 } from "../../s3";
import { logAiActivity } from "../../services/ai-activity";
import {
  getAssetGeneration,
  updateAssetGenerationStatus,
  incrementAssetGenerationRetries,
} from "../../services/asset-generation";
import { buildVisualBrandMemory } from "../../services/workspace-brand-memory";
import type { DB, AssetGenerationStatus, AssetGenerationUseCase } from "../../types/db";
import type {
  OutputSpec,
  PeopleHandling,
} from "../../ai/prompts/asset-generation";

interface ProviderMetadata {
  provider: string;
  providerJobId: string;
  model: string;
  latencyMs: number;
  width?: number;
  height?: number;
  seed?: number | string;
  costUsdApproximate: number | null;
  s3UploadedAt: string;
}

export function generateAssetsProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["generate_assets"]["data"]>) => {
    const { workspaceUuid, assetGenerationUuid, userUuid } = job.data;
    const siteUuid = job.data.siteUuid ?? undefined;

    fastify.log.info(
      { jobId: job.id, assetGenerationUuid },
      "Generate assets worker started",
    );

    const generation = await getAssetGeneration(fastify.db, assetGenerationUuid);
    if (!generation) {
      throw new Error(`Asset generation ${assetGenerationUuid} not found`);
    }
    if ((generation.status as unknown as AssetGenerationStatus) === "ready") {
      fastify.log.info(
        { assetGenerationUuid },
        "Asset generation already ready; skipping",
      );
      return;
    }

    const generationUseCase = generation.useCase as unknown as AssetGenerationUseCase;
    const outputSpec = (generation.outputSpec ?? {}) as unknown as OutputSpec;
    const peoplePolicy: PeopleHandling =
      (outputSpec.peopleHandling as PeopleHandling) ?? "anonymous_only";

    // Idempotency: if a generated asset already exists, skip provider/S3 and
    // proceed straight to analysis/verification.
    if (generation.generatedAssetUuid) {
      const existingAsset = await fastify.db
        .selectFrom("assets")
        .selectAll()
        .where("uuid", "=", generation.generatedAssetUuid)
        .executeTakeFirst();

      if (existingAsset) {
        fastify.log.info(
          { assetGenerationUuid, assetUuid: existingAsset.uuid },
          "Generated asset already exists; re-running analysis and verification",
        );
        await runAnalysisAndVerification(
          fastify,
          workspaceUuid,
          siteUuid,
          assetGenerationUuid,
          userUuid,
          generationUseCase,
          existingAsset,
          peoplePolicy,
        );
        return;
      }
    }

    try {
      await updateAssetGenerationStatus(fastify.db, assetGenerationUuid, "generating");

      const brandMemory = await buildVisualBrandMemory(fastify.db, workspaceUuid);

      const referenceResult = await selectReferenceAssets({
        db: fastify.db,
        workspaceUuid,
        useCase: generationUseCase,
        userAssetUuids:
          (generation.referenceAssetUuids as string[] | null) ?? undefined,
        brandMemory,
      });

      if (referenceResult.assets.length === 0) {
        throw new Error(
          `No usable reference assets for generation ${assetGenerationUuid}: ${referenceResult.warnings.join("; ")}`,
        );
      }

      const promptResult = buildImageGenerationPrompt({
        useCase: generationUseCase,
        subject: generation.subject,
        referenceAssets: referenceResult.assets,
        brandMemory,
        outputSpec: {
          aspectRatio: outputSpec.aspectRatio ?? "16:9",
          style: outputSpec.style ?? "photorealistic",
          peopleHandling: peoplePolicy,
        },
      });

      await updateAssetGenerationStatus(fastify.db, assetGenerationUuid, "generating", {
        promptSnapshot: {
          prompt: promptResult.prompt,
          negativePrompt: promptResult.negativePrompt,
          referenceImageUrls: promptResult.referenceImageUrls,
          warnings: promptResult.warnings,
          safetyFlags: promptResult.safetyFlags,
        } as unknown as Record<string, unknown>,
      });

      const provider = createImageProvider(fastify.config, fastify.log);
      const generated = await provider.generate({
        prompt: promptResult.prompt,
        negativePrompt: promptResult.negativePrompt,
        referenceImageUrls: promptResult.referenceImageUrls,
        aspectRatio: promptResult.aspectRatio,
        peoplePolicy: promptResult.peoplePolicy,
      });

      const { publicUrl, storageKey } = await uploadBufferToS3({
        endpoint: fastify.config.S3_ENDPOINT,
        region: fastify.config.S3_REGION,
        accessKeyId: fastify.config.S3_ACCESS_KEY,
        secretAccessKey: fastify.config.S3_SECRET_KEY,
        sessionToken: fastify.config.S3_SESSION_TOKEN,
        bucket: fastify.config.S3_ASSETS_BUCKET,
        workspaceUuid,
        filename: `${assetGenerationUuid}.png`,
        buffer: generated.imageBuffer,
        contentType: "image/png",
      });

      const providerMetadata: ProviderMetadata = {
        provider: generated.provider,
        providerJobId: generated.providerJobId,
        model: generated.metadata.model as string,
        latencyMs: generated.metadata.latencyMs as number,
        width: generated.metadata.width as number | undefined,
        height: generated.metadata.height as number | undefined,
        seed: generated.metadata.seed as number | string | undefined,
        costUsdApproximate: generated.costUsd ?? null,
        s3UploadedAt: new Date().toISOString(),
      };

      await updateAssetGenerationStatus(fastify.db, assetGenerationUuid, "uploaded", {
        provider: generated.provider,
        providerJobId: generated.providerJobId,
        costUsd: generated.costUsd ?? null,
        metadata: { ...providerMetadata },
      });

      const asset = await fastify.db
        .insertInto("assets")
        .values({
          workspaceUuid,
          name: `AI-generated ${generationUseCase.replace(/_/g, " ")}`,
          type: "image",
          source: "ai_generated",
          mimeType: "image/png",
          url: publicUrl,
          storageKey,
          metadata: {
            source: "ai_generated",
            generationUuid: assetGenerationUuid,
            useCase: generationUseCase,
            consent: {
              peoplePolicy,
              generated: true,
            },
          } as unknown as DB["assets"]["metadata"],
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await updateAssetGenerationStatus(fastify.db, assetGenerationUuid, "analyzing", {
        generatedAssetUuid: asset.uuid,
      });

      await analyzeAsset({
        db: fastify.db,
        config: fastify.config,
        workspaceUuid,
        assetUuid: asset.uuid,
        userUuid,
        siteUuid,
        aiJobUuid: null,
        log: fastify.log,
      });

      const analyzedAsset = await fastify.db
        .selectFrom("assets")
        .selectAll()
        .where("uuid", "=", asset.uuid)
        .executeTakeFirstOrThrow();

      const analysis = (analyzedAsset.metadata as Record<string, unknown> | null)
        ?.analysis as import("../../utils/asset-analysis").AnalysisOutput | undefined;

      if (!analysis) {
        throw new Error("Generated asset analysis failed");
      }

      const verification = verifyGeneratedAsset({
        generatedAnalysis: analysis,
        referenceAssets: referenceResult.assets,
        expectedUseCase: generationUseCase,
        peoplePolicy,
      });

      if (!verification.passed) {
        throw new Error(
          `Generated asset failed verification: ${verification.issues.join(", ")}`,
        );
      }

      await finishGeneration(
        fastify,
        workspaceUuid,
        siteUuid,
        assetGenerationUuid,
        userUuid,
        generationUseCase,
        asset,
        providerMetadata,
        verification,
        promptResult.warnings,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fastify.log.warn(
        { jobId: job.id, assetGenerationUuid, err },
        "Asset generation failed",
      );

      await incrementAssetGenerationRetries(fastify.db, assetGenerationUuid);
      await updateAssetGenerationStatus(fastify.db, assetGenerationUuid, "failed", {
        failureReason: reason,
      });

      await logAiActivity(fastify.db, {
        workspaceUuid,
        userUuid,
        siteUuid: siteUuid ?? null,
        aiJobUuid: null,
        actionType: "generate_image",
        model: fastify.config.FAL_IMAGE_MODEL,
        provider: "fal",
        outcome: "failure",
        summary: `Image generation failed for ${generationUseCase}`,
        promptTemplateKeys: ["asset-generation"],
        errorMessage: reason,
        metadata: { assetGenerationUuid, failureReason: reason },
      });

      // Do not re-throw: the failure has been recorded and surfaced to the UI.
      return;
    }
  };
}

async function runAnalysisAndVerification(
  fastify: FastifyInstance,
  workspaceUuid: string,
  siteUuid: string | undefined,
  assetGenerationUuid: string,
  userUuid: string,
  generationUseCase: AssetGenerationUseCase,
  asset: {
    uuid: string;
    workspaceUuid: string;
    type: string;
    source: string;
    mimeType: string | null;
    url: string;
    storageKey: string;
    name: string;
    metadata: unknown;
  },
  peoplePolicy: PeopleHandling,
) {
  const generation = await getAssetGeneration(fastify.db, assetGenerationUuid);
  if (!generation) {
    throw new Error(`Asset generation ${assetGenerationUuid} not found`);
  }

  const brandMemory = await buildVisualBrandMemory(fastify.db, workspaceUuid);
  const referenceResult = await selectReferenceAssets({
    db: fastify.db,
    workspaceUuid,
    useCase: generationUseCase,
    userAssetUuids:
      (generation.referenceAssetUuids as string[] | null) ?? undefined,
    brandMemory,
  });

  await updateAssetGenerationStatus(fastify.db, assetGenerationUuid, "analyzing", {
    generatedAssetUuid: asset.uuid as string,
  });

  await analyzeAsset({
    db: fastify.db,
    config: fastify.config,
    workspaceUuid,
    assetUuid: asset.uuid,
    userUuid,
    siteUuid,
    aiJobUuid: null,
    log: fastify.log,
  });

  const analyzedAsset = await fastify.db
    .selectFrom("assets")
    .selectAll()
    .where("uuid", "=", asset.uuid as string)
    .executeTakeFirstOrThrow();

  const analysis = (analyzedAsset.metadata as Record<string, unknown> | null)
    ?.analysis as import("../../utils/asset-analysis").AnalysisOutput | undefined;

  if (!analysis) {
    throw new Error("Generated asset analysis failed");
  }

  const verification = verifyGeneratedAsset({
    generatedAnalysis: analysis,
    referenceAssets: referenceResult.assets,
    expectedUseCase: generationUseCase,
    peoplePolicy,
  });

  if (!verification.passed) {
    throw new Error(
      `Generated asset failed verification: ${verification.issues.join(", ")}`,
    );
  }

  const metadata = (generation.metadata ?? {}) as Record<string, unknown>;
  const providerMetadata: ProviderMetadata = {
    provider: (metadata.provider as string) ?? "fal",
    providerJobId: (metadata.providerJobId as string) ?? "",
    model: fastify.config.FAL_IMAGE_MODEL,
    latencyMs: (metadata.latencyMs as number) ?? 0,
    costUsdApproximate:
      generation.costUsd !== null ? Number(generation.costUsd) : null,
    s3UploadedAt: (metadata.s3UploadedAt as string) ?? new Date().toISOString(),
  };

  await finishGeneration(
    fastify,
    workspaceUuid,
    siteUuid,
    assetGenerationUuid,
    userUuid,
    generationUseCase,
    asset,
    providerMetadata,
    verification,
    [],
  );
}

async function finishGeneration(
  fastify: FastifyInstance,
  workspaceUuid: string,
  siteUuid: string | undefined,
  assetGenerationUuid: string,
  userUuid: string,
  generationUseCase: AssetGenerationUseCase,
  asset: {
    uuid: string;
    workspaceUuid: string;
    type: string;
    source: string;
    mimeType: string | null;
    url: string;
    storageKey: string;
    name: string;
    metadata: unknown;
  },
  providerMetadata: ProviderMetadata,
  verification: { passed: boolean; fidelityScore: number; issues: string[] },
  warnings: string[],
) {
  await updateAssetGenerationStatus(fastify.db, assetGenerationUuid, "ready");

  await logAiActivity(fastify.db, {
    workspaceUuid,
    userUuid,
    siteUuid: siteUuid ?? null,
    aiJobUuid: null,
    actionType: "generate_image",
    model: providerMetadata.model,
    provider: providerMetadata.provider,
    costUsd: providerMetadata.costUsdApproximate ?? 0,
    latencyMs: providerMetadata.latencyMs,
    outcome: "success",
    summary: `Generated ${generationUseCase} image for workspace`,
    promptTemplateKeys: ["asset-generation"],
    metadata: {
      assetGenerationUuid,
      generatedAssetUuid: asset.uuid,
      providerJobId: providerMetadata.providerJobId,
      costUsdApproximate: providerMetadata.costUsdApproximate,
      fidelityScore: verification.fidelityScore,
      warnings,
    },
  });

  fastify.log.info(
    { assetGenerationUuid, assetUuid: asset.uuid },
    "Generate assets worker finished",
  );
}
