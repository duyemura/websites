import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { db } from "../../src/database";
import { setupTestContext } from "../setup";
import { deploySnapshot, loadActiveTransforms, markStaleTransforms } from "../../src/services/mirror/deploy";
import { jsonb } from "../../src/utils/jsonb";
import type { MirrorSnapshotArtifact } from "../../src/types/mirror";

// ---------------------------------------------------------------------------
// S3 mock — in-memory bucket backed by a Map
// ---------------------------------------------------------------------------
function createMockS3(initial: Record<string, string> = {}) {
  const storage = new Map(Object.entries(initial));
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      const key = command.input.Key ?? "";
      const content = storage.get(key) ?? "";
      return { Body: { transformToString: async () => content } };
    }
    if (command instanceof PutObjectCommand) {
      const key = command.input.Key ?? "";
      const body = (command.input.Body as Buffer | string | undefined)?.toString() ?? "";
      storage.set(key, body);
      return {};
    }
    if (command instanceof CopyObjectCommand) {
      const srcKey = (command.input.CopySource ?? "").split("/").slice(1).join("/");
      storage.set(command.input.Key ?? "", storage.get(srcKey) ?? "");
      return {};
    }
    if (command instanceof DeleteObjectCommand) {
      storage.delete(command.input.Key ?? "");
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? "";
      const contents = [...storage.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ Key: k }));
      return { Contents: contents, IsTruncated: false };
    }
    return {};
  });
  return { send: send as unknown as import("@aws-sdk/client-s3").S3Client["send"], storage };
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------
const SITE_UUID = "00000000-0000-0000-0000-000000000001";
const DEPLOY_ID = "1-test";
const SNAPSHOT_PREFIX = `sites/${SITE_UUID}/snapshots/1`;
const PAGE_HTML_KEY = `${SNAPSHOT_PREFIX}/crawl/index.html`;

const BASE_SNAPSHOT: MirrorSnapshotArtifact = {
  s3Prefix: SNAPSHOT_PREFIX,
  pages: [{ path: "/", htmlKey: PAGE_HTML_KEY }],
  redirects: [],
  assetCount: 0,
  warnings: [],
};

const BASE_PAGE_HTML = `<html><head><title>Gym</title></head><body><h1>Welcome</h1></body></html>`;

function makeS3(extraContent: Record<string, string> = {}) {
  return createMockS3({ [PAGE_HTML_KEY]: BASE_PAGE_HTML, ...extraContent });
}

function makeDeps(
  s3: ReturnType<typeof createMockS3>,
  overrides: { preview?: boolean; siteUuid?: string } = {},
) {
  const siteUuid = overrides.siteUuid ?? SITE_UUID;
  return {
    db,
    s3Client: { send: s3.send } as unknown as import("@aws-sdk/client-s3").S3Client,
    bucket: "test-bucket",
    siteUuid,
    deployId: DEPLOY_ID,
    host: "https://gym.ploysites.com",
    preview: overrides.preview ?? true,
    publicUrl: (key: string) => `https://s3.test/${key}`,
    log: { info: () => undefined },
  };
}

// ---------------------------------------------------------------------------
// DB-backed helper tests
// ---------------------------------------------------------------------------
describe("deploy transform loading", () => {
  let workspaceUuid: string;
  let siteUuid: string;

  beforeEach(async () => {
    const ctx = await setupTestContext();
    workspaceUuid = ctx.workspace.uuid;
    const site = await db
      .insertInto("sites")
      .values({ workspaceUuid, name: "Test Gym", slug: "test-gym" })
      .returning("uuid")
      .executeTakeFirstOrThrow();
    siteUuid = site.uuid;
  });

  it("loads only active transforms ordered by ordinal", async () => {
    await db.insertInto("siteTransforms").values([
      { siteUuid, workspaceUuid, ordinal: 2, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "B" }) },
      { siteUuid, workspaceUuid, ordinal: 1, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "A" }) },
      { siteUuid, workspaceUuid, ordinal: 3, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "C" }), status: "disabled" },
    ]).execute();

    const transforms = await loadActiveTransforms(db, siteUuid);
    expect(transforms.map((t) => t.ordinal)).toEqual([1, 2]);
  });

  it("excludes stale transforms as well as disabled", async () => {
    await db.insertInto("siteTransforms").values([
      { siteUuid, workspaceUuid, ordinal: 1, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "A" }) },
      { siteUuid, workspaceUuid, ordinal: 2, type: "meta-set", pageGlob: "/", payload: jsonb({ title: "B" }), status: "stale" },
    ]).execute();

    const transforms = await loadActiveTransforms(db, siteUuid);
    expect(transforms).toHaveLength(1);
    expect(transforms[0]?.ordinal).toBe(1);
  });

  it("marks stale transforms by uuid", async () => {
    const row = await db.insertInto("siteTransforms")
      .values({ siteUuid, workspaceUuid, ordinal: 1, type: "attr-set", pageGlob: "/", selector: ".gone", payload: jsonb({ attr: "alt", value: "x" }) })
      .returning("uuid").executeTakeFirstOrThrow();

    await markStaleTransforms(db, [row.uuid]);
    const after = await db.selectFrom("siteTransforms").select("status").where("uuid", "=", row.uuid).executeTakeFirstOrThrow();
    expect(after.status).toBe("stale");

    // Stale transforms are excluded from future loads
    const active = await loadActiveTransforms(db, siteUuid);
    expect(active).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deploySnapshot — S3-mock-backed tests
// ---------------------------------------------------------------------------
describe("deploySnapshot", () => {
  const deployPrefix = `sites/${SITE_UUID}/deploys/${DEPLOY_ID}`;

  it("preview mode: robots.txt blocks all crawlers", async () => {
    const s3 = makeS3();
    await deploySnapshot(BASE_SNAPSHOT, makeDeps(s3, { preview: true }));

    const robots = s3.storage.get(`${deployPrefix}/robots.txt`) ?? "";
    expect(robots).toContain("Disallow: /");
    expect(robots).not.toContain("Allow: /");
  });

  it("preview mode: does NOT emit sitemap.xml", async () => {
    const s3 = makeS3();
    await deploySnapshot(BASE_SNAPSHOT, makeDeps(s3, { preview: true }));

    expect(s3.storage.has(`${deployPrefix}/sitemap.xml`)).toBe(false);
  });

  it("preview mode: injects noindex meta into page HTML", async () => {
    const s3 = makeS3();
    await deploySnapshot(BASE_SNAPSHOT, makeDeps(s3, { preview: true }));

    const html = s3.storage.get(`${deployPrefix}/index.html`) ?? "";
    expect(html).toContain('content="noindex"');
  });

  it("production mode: robots.txt allows crawlers and sitemap is emitted", async () => {
    const s3 = makeS3();
    await deploySnapshot(BASE_SNAPSHOT, makeDeps(s3, { preview: false }));

    const robots = s3.storage.get(`${deployPrefix}/robots.txt`) ?? "";
    expect(robots).toContain("Allow: /");
    expect(s3.storage.has(`${deployPrefix}/sitemap.xml`)).toBe(true);
  });

  it("production mode: page HTML does NOT have noindex meta", async () => {
    const s3 = makeS3();
    await deploySnapshot(BASE_SNAPSHOT, makeDeps(s3, { preview: false }));

    const html = s3.storage.get(`${deployPrefix}/index.html`) ?? "";
    expect(html).not.toContain('content="noindex"');
  });

  it("preview mode: noindex is injected into page-replace artifacts, not bypassed (C1)", async () => {
    const artifactKey = "artifacts/replacement.html";
    const replacementHtml = `<html><head><title>New Page</title></head><body>New</body></html>`;
    const s3 = makeS3({ [artifactKey]: replacementHtml });

    // Seed a page-replace transform via direct DB insert won't work here since
    // SITE_UUID is not a real DB row — test the logic by checking that in preview
    // mode the code fetches+injects rather than raw-copying.
    // We exercise this path by creating a real site + transform:
    const ctx = await setupTestContext();
    const site = await db
      .insertInto("sites")
      .values({ workspaceUuid: ctx.workspace.uuid, name: "G", slug: "g" })
      .returning("uuid").executeTakeFirstOrThrow();

    await db.insertInto("siteTransforms").values({
      siteUuid: site.uuid,
      workspaceUuid: ctx.workspace.uuid,
      ordinal: 1,
      type: "page-replace",
      pageGlob: "/",
      payload: jsonb({ artifactRef: artifactKey }),
    }).execute();

    const snapshot: MirrorSnapshotArtifact = {
      s3Prefix: `sites/${site.uuid}/snapshots/1`,
      pages: [{ path: "/", htmlKey: PAGE_HTML_KEY }],
      redirects: [],
      assetCount: 0,
      warnings: [],
    };

    await deploySnapshot(snapshot, {
      ...makeDeps(s3, { preview: true }),
      siteUuid: site.uuid,
      deployId: "test-pr",
    });

    const deployed = s3.storage.get(`sites/${site.uuid}/deploys/test-pr/index.html`) ?? "";
    // Should have fetched the artifact and injected noindex, not raw-copied
    expect(deployed).toContain("New Page"); // content from artifact
    expect(deployed).toContain('content="noindex"'); // noindex injected
  });

  it("continues deploying other pages when one S3 read fails (I1)", async () => {
    const twoPageSnapshot: MirrorSnapshotArtifact = {
      ...BASE_SNAPSHOT,
      pages: [
        { path: "/", htmlKey: "missing-key" },
        { path: "/coaches", htmlKey: PAGE_HTML_KEY },
      ],
    };
    const s3 = makeS3();
    // Override send to throw on the missing key
    const originalSend = s3.send;
    s3.send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand && command.input.Key === "missing-key") {
        throw new Error("NoSuchKey");
      }
      return originalSend(command);
    }) as typeof s3.send;

    const result = await deploySnapshot(twoPageSnapshot, makeDeps(s3, { preview: false }));

    // /coaches should still be deployed
    expect(s3.storage.has(`${deployPrefix}/coaches/index.html`)).toBe(true);
    // / should be absent (read failed)
    expect(s3.storage.has(`${deployPrefix}/index.html`)).toBe(false);
    expect(result.warnings.some((w) => w.includes("deploy read failed"))).toBe(true);
  });

  it("page-replace with invalid artifactRef is marked stale, deploy continues (I3/I4)", async () => {
    const ctx = await setupTestContext();
    const site = await db
      .insertInto("sites")
      .values({ workspaceUuid: ctx.workspace.uuid, name: "G2", slug: "g2" })
      .returning("uuid").executeTakeFirstOrThrow();

    await db.insertInto("siteTransforms").values({
      siteUuid: site.uuid,
      workspaceUuid: ctx.workspace.uuid,
      ordinal: 1,
      type: "page-replace",
      pageGlob: "/nowhere", // glob matches no page in snapshot
      payload: jsonb({ artifactRef: "nonexistent-ref" }),
    }).execute();

    const snapshot: MirrorSnapshotArtifact = {
      s3Prefix: `sites/${site.uuid}/snapshots/1`,
      pages: [{ path: "/", htmlKey: PAGE_HTML_KEY }],
      redirects: [],
      assetCount: 0,
      warnings: [],
    };

    const s3 = makeS3();
    const result = await deploySnapshot(snapshot, {
      ...makeDeps(s3, { preview: false }),
      siteUuid: site.uuid,
      deployId: "test-pr2",
    });

    // page-replace that matched no page should be in stale list
    expect(result.stale).toHaveLength(1);
    // / page was still deployed normally
    expect(s3.storage.has(`sites/${site.uuid}/deploys/test-pr2/index.html`)).toBe(true);

    // Verify the stale transform was updated in the DB
    const tr = await db
      .selectFrom("siteTransforms")
      .select("status")
      .where("siteUuid", "=", site.uuid)
      .executeTakeFirstOrThrow();
    expect(tr.status).toBe("stale");
  });
});

// ---------------------------------------------------------------------------
// promoteDeploy — stale cleanup
// ---------------------------------------------------------------------------
describe("promoteDeploy", () => {
  it("deletes stale objects from current/ not present in the new deploy", async () => {
    const { promoteDeploy } = await import("../../src/services/mirror/deploy");
    const siteUuid = "promo-site";
    const deployPrefix = `sites/${siteUuid}/deploys/2`;
    const currentPrefix = `sites/${siteUuid}/current`;

    const s3 = createMockS3({
      [`${deployPrefix}/index.html`]: "<html>new</html>",
      [`${currentPrefix}/index.html`]: "<html>old</html>",
      [`${currentPrefix}/old-page/index.html`]: "<html>stale</html>", // not in new deploy
    });

    await promoteDeploy(
      { send: s3.send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "test-bucket",
      siteUuid,
      deployPrefix,
    );

    // Stale file should be gone
    expect(s3.storage.has(`${currentPrefix}/old-page/index.html`)).toBe(false);
    // New content should be present
    expect(s3.storage.get(`${currentPrefix}/index.html`)).toBe("<html>new</html>");
  });
});
