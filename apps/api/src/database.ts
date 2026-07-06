import {
  FileMigrationProvider,
  Migrator,
  PostgresDialect,
  Kysely,
  CamelCasePlugin,
} from "kysely";
import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";
import { DB } from "./types/db";
import type { Config } from "./plugins/env";

function buildDialect(config: Config) {
  return new PostgresDialect({
    pool: new Pool({
      database: config.DB_NAME,
      host: config.DB_HOST,
      port: config.DB_PORT,
      user: config.DB_USER,
      password: config.DB_PASSWORD,
      ssl:
        config.NODE_ENV === "production"
          ? {
              rejectUnauthorized: true,
              ca: config.DB_SSL_CA,
            }
          : false,
    }),
  });
}

export function createDatabase(config: Config) {
  return new Kysely<DB>({
    dialect: buildDialect(config),
    plugins: [new CamelCasePlugin()],
  });
}

export function createMigrator(db: Kysely<DB>) {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.resolve(path.join(__dirname, "migrations")),
    }),
  });
}

const dbConfig = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  SERVICE: process.env.SERVICE ?? "monolith",
  DB_HOST: process.env.DB_HOST ?? "localhost",
  DB_PORT: +(process.env.DB_PORT || 5432),
  DB_USER: process.env.DB_USER ?? "postgres",
  DB_PASSWORD: process.env.DB_PASSWORD ?? "postgres",
  DB_NAME: process.env.DB_NAME ?? "ploygyms",
  DB_SSL_CA: process.env.DB_SSL_CA,
  MIGRATE_ON_START: process.env.MIGRATE_ON_START === "true",
  REDIS_HOST: process.env.REDIS_HOST ?? "localhost",
  REDIS_PORT: +(process.env.REDIS_PORT || 6379),
  REDIS_USERNAME: process.env.REDIS_USERNAME,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD,
  REDIS_CLUSTER: process.env.REDIS_CLUSTER === "true",
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "",
  S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "",
  S3_SESSION_TOKEN: process.env.S3_SESSION_TOKEN,
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_ASSETS_BUCKET: process.env.S3_ASSETS_BUCKET ?? "",
  S3_DEPLOYMENTS_BUCKET: process.env.S3_DEPLOYMENTS_BUCKET,
  CDN_BASE_URL: process.env.CDN_BASE_URL ?? "",
  CLOUDFRONT_KVS_ARN: process.env.CLOUDFRONT_KVS_ARN,
  CLOUDFRONT_DISTRIBUTION_ID: process.env.CLOUDFRONT_DISTRIBUTION_ID,
  MILO_PREVIEW_DOMAIN: process.env.MILO_PREVIEW_DOMAIN,
  LLM_PROVIDER: process.env.LLM_PROVIDER ?? "ollama",
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL:
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  DEFAULT_LLM_MODEL: process.env.DEFAULT_LLM_MODEL ?? "qwen3.5:397b-cloud",
  VISION_LLM_MODEL: process.env.VISION_LLM_MODEL ?? "gemma4:31b-cloud",
  CHEAP_LLM_MODEL: process.env.CHEAP_LLM_MODEL ?? "qwen3.6:35b-a3b-nvfp4",
  CODE_LLM_MODEL: process.env.CODE_LLM_MODEL ?? "kimi-k2.7-code:cloud",
  LONG_CONTEXT_LLM_MODEL:
    process.env.LONG_CONTEXT_LLM_MODEL ?? "qwen3.5:397b-cloud",
  REASONING_LLM_MODEL: process.env.REASONING_LLM_MODEL ?? "qwen3.5:397b-cloud",
} as Config;

// Default singleton used by the kysely-ctl CLI. The app creates its own
// instance from config so it can be safely closed per test run.
export const db = createDatabase(dbConfig);

export const config = dbConfig;

export const migrator = createMigrator(db);
