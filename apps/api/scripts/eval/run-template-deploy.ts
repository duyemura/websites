/**
 * Build + deploy the Astro template for a site, record a version, optionally publish.
 *
 * Usage (from apps/api/):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/eval/run-template-deploy.ts \
 *     --site <siteUuid> --content ../renderer/src/content/gym.fixture.json [--publish]
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db, config } from "../../src/database";
import { getS3Client } from "../../src/s3";
import { deployTemplate } from "../../src/services/template/deploy-template";
import { publishSiteVersion } from "../../src/services/site-versions";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && !process.argv[i + 1]?.startsWith("--") ? process.argv[i + 1] : undefined;
}

async function main() {
  const siteUuid = arg("site");
  const contentPath = arg("content");
  const publish = process.argv.includes("--publish");
  if (!siteUuid) {
    console.error("Usage: --site <uuid> [--content <path-to-gym.json>] [--publish]");
    process.exit(1);
  }

  const site = await db.selectFrom("sites").select(["uuid", "workspaceUuid", "customDomain"]).where("uuid", "=", siteUuid).executeTakeFirstOrThrow();
  const content = contentPath ? JSON.parse(readFileSync(contentPath, "utf8")) : undefined;
  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  const s3Client = getS3Client({
    endpoint: config.S3_ENDPOINT, region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY,
  });
  const rendererDir = path.resolve(process.cwd(), "../renderer");

  const result = await deployTemplate({
    db, s3Client, bucket,
    siteUuid: site.uuid, workspaceUuid: site.workspaceUuid,
    content,
    apiBaseUrl: config.CDN_BASE_URL,
    siteUrl: site.customDomain
      ? `https://${site.customDomain}`
      : `${config.CDN_BASE_URL}/sites/${site.uuid}/current`,
    rendererDir,
    log: { info: (o, m) => console.log(m, o) },
  });
  console.log(`Version ${result.version} @ ${result.deployPrefix} — ${result.routes} routes, ${result.redirects.length} redirects`);
  for (const r of result.redirects) console.log(`  301 ${r.from} → ${r.to} (${r.reason})`);

  if (publish) {
    await publishSiteVersion(db, s3Client, bucket, site.uuid, result.version);
    console.log(`Published version ${result.version} to current/`);
  }
  await db.destroy();
}

main().catch((err) => { console.error(err); process.exit(1); });
