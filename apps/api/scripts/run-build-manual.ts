import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

async function main() {
  const [{ db, config }, { loadBlueprintDoc, pageBySlug }, { loadOrBuildDesignSystem }, { generateAstroPage }] = await Promise.all([
    import("../src/database"),
    import("../src/utils/blueprint-io"),
    import("../src/utils/design-system-io"),
    import("../src/services/astro-code-generator"),
  ]);

  const siteUuid = process.argv[2];
  if (!siteUuid) {
    console.error("Usage: pnpm exec tsx scripts/run-build-manual.ts <siteUuid>");
    process.exit(1);
  }
  const site = await db
    .selectFrom("sites")
    .selectAll()
    .where("uuid", "=", siteUuid)
    .executeTakeFirstOrThrow();

  const blueprint = await loadBlueprintDoc(db, site.workspaceUuid, siteUuid);
  if (!blueprint) throw new Error("No blueprint doc");

  const designSystem = await loadOrBuildDesignSystem(
    db,
    config,
    site.workspaceUuid,
    siteUuid,
    (site.mode as "replication" | "template" | "greenfield") ?? "replication",
    blueprint,
    null,
  );

  const page = pageBySlug(blueprint, "index");
  if (!page) throw new Error("No index page in blueprint");

  const crypto = await import("node:crypto");
  const attemptId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const result = await generateAstroPage({
    db,
    config,
    workspaceUuid: site.workspaceUuid,
    siteUuid,
    pageSlug: "index",
    designSystem,
    page,
    attemptId,
  });

  console.log("buildSuccess:", result.buildSuccess);
  console.log("previewUrl:", result.previewUrl);
  console.log("buildLog:\n", result.buildLog);
  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  try {
    const { db } = await import("../src/database");
    await db.destroy();
  } catch {}
  process.exit(1);
});
