import type { FastifyBaseLogger } from "fastify";
import type { GenerateImageInput, GenerateImageResult, ImageProvider } from "./types";

interface FalImage {
  url: string;
  width?: number;
  height?: number;
  content_type?: string;
}

interface FalResult {
  images: FalImage[];
  seed?: number;
  has_nsfw_concepts?: boolean[];
}

interface FalErrorBody {
  detail?: string;
  message?: string;
}

const ASPECT_RATIO_TO_FAL_SIZE: Record<string, string | { width: number; height: number }> = {
  "16:9": "landscape_16_9",
  "4:3": "landscape_4_3",
  "1:1": "square_1_1",
  "9:16": "portrait_16_9",
  "21:9": { width: 1792, height: 768 },
};

function mapAspectRatio(aspectRatio: string): string | { width: number; height: number } {
  return ASPECT_RATIO_TO_FAL_SIZE[aspectRatio] ?? "landscape_16_9";
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Failed to download generated image: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export interface FalProviderConfig {
  key: string;
  model: string;
  log?: FastifyBaseLogger;
}

export function createFalImageProvider(config: FalProviderConfig): ImageProvider {
  return {
    async generate(input: GenerateImageInput): Promise<GenerateImageResult> {
      const { prompt, negativePrompt, referenceImageUrls, aspectRatio } = input;
      const imageUrl = referenceImageUrls[0];
      const size = mapAspectRatio(aspectRatio);

      const payload: Record<string, unknown> = {
        prompt,
        negative_prompt: negativePrompt,
        num_images: 1,
        image_size: size,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        strength: 0.75,
        enable_safety_checker: true,
      };

      if (imageUrl) {
        payload.image_url = imageUrl;
      }

      const url = `https://fal.run/${config.model}`;
      config.log?.info({ model: config.model, aspectRatio }, "Calling fal image generation");

      const start = Date.now();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Key ${config.key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as FalErrorBody;
        throw new Error(
          `fal image generation failed: ${response.status} ${body.detail ?? body.message ?? response.statusText}`,
        );
      }

      const result = (await response.json()) as FalResult;
      const image = result.images?.[0];
      if (!image?.url) {
        throw new Error("fal image generation returned no images");
      }

      if (result.has_nsfw_concepts?.[0]) {
        throw new Error("Generated image was flagged by the safety checker");
      }

      const imageBuffer = await fetchImageBuffer(image.url);

      // fal does not return per-request cost in the sync response, so we
      // approximate based on the returned dimensions. This is a placeholder
      // until fal exposes costUsd in their payload.
      const costUsd = approximateFalCost(image.width, image.height);

      return {
        imageBuffer,
        provider: "fal",
        providerJobId: String(result.seed ?? ""),
        costUsd,
        metadata: {
          model: config.model,
          width: image.width,
          height: image.height,
          latencyMs,
          seed: result.seed,
        },
      };
    },
  };
}

function approximateFalCost(width?: number, height?: number): number | null {
  if (!width || !height) return null;
  const pixels = width * height;
  // Rough estimate for FLUX.1 [dev] img2img at ~$0.001 per 1M pixels.
  return Math.round((pixels / 1_000_000) * 0.001 * 1000) / 1000;
}
