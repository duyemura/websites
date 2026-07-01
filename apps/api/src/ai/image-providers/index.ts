import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../../plugins/env";
import type { ImageProvider } from "./types";
import { createFalImageProvider } from "./fal";

export * from "./types";
export { createFalImageProvider } from "./fal";

export function createImageProvider(
  config: Config,
  log?: FastifyBaseLogger,
): ImageProvider {
  if (!config.FAL_KEY) {
    throw new Error("FAL_KEY is required for image generation");
  }
  return createFalImageProvider({
    key: config.FAL_KEY,
    model: config.FAL_IMAGE_MODEL,
    log,
  });
}
