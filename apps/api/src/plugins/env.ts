import fp from "fastify-plugin";
import { z } from "zod";
import { Service } from "../manifest";

const booleanFromEnv = (defaultValue: boolean) =>
  z
    .enum(["true", "false"])
    .optional()
    .default(defaultValue ? "true" : "false")
    .transform((v) => v === "true");

const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]),
  SERVICE: z.enum(Service.options as [string, ...string[]]),
  DB_HOST: z.string(),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string(),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string(),
  DB_SSL_CA: z.string().optional(),
  MIGRATE_ON_START: booleanFromEnv(true),
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_CLUSTER: booleanFromEnv(false),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  S3_ENDPOINT: z.string(),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ASSETS_BUCKET: z.string(),
  S3_DEPLOYMENTS_BUCKET: z.string().optional(),
  CDN_BASE_URL: z.string(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  DEFAULT_LLM_MODEL: z.string().default("anthropic/claude-3.5-sonnet"),
  VISION_LLM_MODEL: z.string().default("openai/gpt-4o"),
  CHEAP_LLM_MODEL: z.string().default("google/gemini-flash-1.5"),
});

export type Config = z.infer<typeof ConfigSchema>;

export default fp(
  async (fastify) => {
    const config = ConfigSchema.parse(process.env);
    fastify.decorate("config", config);
  },
  { name: "env", dependencies: [] },
);

declare module "fastify" {
  interface FastifyInstance {
    config: Config;
  }
}
