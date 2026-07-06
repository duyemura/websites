/**
 * Re-run the Astro build for an existing site using its current locked docs,
 * without re-scraping the source. Useful for iterating on renderer/extraction
 * code and comparing the new preview to a previous screenshot.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/rebuild-site-preview.ts <site-uuid>
 *
 * Example:
 *   npx tsx scripts/rebuild-site-preview.ts 50cc678b-9a26-4a2b-a205-a870022923cc
 */
import "dotenv/config";
import { db, config } from "../src/database";
import { buildPage } from "../src/services/site-generation-orchestrator";
import bull from "../src/bullmq";
import { jsonb } from "../src/utils/jsonb";

async function main() {
  const siteUuid = process.argv[2];
  if (!siteUuid) {
    console.error("Usage: npx tsx scripts/rebuild-site-preview.ts <site-uuid>");
    process.exit(1);
  }

  const site = await db.selectFrom("sites").selectAll().where("uuid", "=", siteUuid).executeTakeFirst();
  if (!site) {
    console.error(`Site ${siteUuid} not found`);
    process.exit(1);
  }

  const workspaceUuid = site.workspaceUuid;
  const mode = (site.mode ?? "replication") as "replication" | "template" | "greenfield";

  console.log(`Rebuilding homepage for ${site.name} (${siteUuid}) in workspace ${workspaceUuid}`);

  // Create a fresh parent aiJob for this incremental run.
  const aiJob = await db
    .insertInto("aiJobs")
    .values({
      workspaceUuid,
      siteUuid,
      type: "replicate_site",
      status: "running",
      input: jsonb({ siteUuid, workspaceUuid, options: { accuracy: "accurate" } }),
      state: jsonb({ phase: "design_system", currentSlug: "index" }),
      steps: jsonb([{ name: "build_homepage", status: "in_progress" }]),
      options: jsonb({ accuracy: "accurate" }),
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  const aiJobUuid = aiJob.uuid;

  const queues = {
    classifyAssets: bull.build("classify_assets"),
    unclassifiedAssets: bull.build("unclassified_assets"),
    generatePage: bull.build("generate_page"),
    generateAssets: bull.build("generate_assets"),
    replicateSite: bull.build("replicate_site"),
    sitePublish: bull.build("site_publish"),
    playbookRun: bull.build("playbook_run"),
  };

  const attemptId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const result = await buildPage({
    db,
    queues,
    config,
    workspaceUuid,
    siteUuid,
    pageSlug: "index",
    aiJobUuid,
    attemptId,
    mode,
  });

  console.log("\nBuild result:");
  console.log(`  passed:        ${result.passed}`);
  console.log(`  fidelityScore: ${result.fidelityScore.toFixed(4)}`);
  console.log(`  previewUrl:    ${result.previewUrl}`);
  if (result.issues.length > 0) {
    console.log(`  issues (${result.issues.length}):`);
    for (const issue of result.issues.slice(0, 10)) {
      console.log(`    [${issue.severity}] ${issue.component_id}: ${issue.description}`);
    }
  }

  await Promise.all(Object.values(queues).map((q) => (q as { close?: () => Promise<unknown> }).close?.()));
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
