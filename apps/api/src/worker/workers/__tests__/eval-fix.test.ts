import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import { evalFixProcessor } from "../eval-fix";
import { finalizeReport } from "../../../services/eval/page-eval-report.js";

vi.mock("../../../services/eval/eval-fix.js", () => ({
  buildFixPlan: vi.fn(),
}));

vi.mock("../../../services/template/content-mapper.js", () => ({
  buildGymJson: vi.fn(),
}));

vi.mock("../../../services/template/deploy-template.js", () => ({
  deployTemplate: vi.fn(),
  buildTemplateLocal: vi.fn(),
  deployTemplateDist: vi.fn(),
}));

vi.mock("../../../services/site-versions.js", () => ({
  publishLatestStagingToProduction: vi.fn(),
}));

vi.mock("../../../services/mirror/deploy.js", () => ({
  promoteDeploy: vi.fn(),
}));

vi.mock("../../../services/eval/page-evaluator.js", () => ({
  evaluatePage: vi.fn(),
}));

vi.mock("../../../utils/site-hierarchy-io.js", () => ({
  loadSiteHierarchyDoc: vi.fn(),
  saveSiteHierarchyDoc: vi.fn(),
}));

vi.mock("../../../utils/design-system-io.js", () => ({
  loadDesignSystemDoc: vi.fn(),
  saveDesignSystemDoc: vi.fn(),
}));

vi.mock("../../../utils/pipeline/artifact-store.js", () => ({
  loadArtifact: vi.fn(),
  saveArtifact: vi.fn(),
}));

import { buildFixPlan } from "../../../services/eval/eval-fix.js";
import { buildGymJson } from "../../../services/template/content-mapper.js";
import { deployTemplate, deployTemplateDist, buildTemplateLocal } from "../../../services/template/deploy-template.js";
import { publishLatestStagingToProduction } from "../../../services/site-versions.js";
import { promoteDeploy } from "../../../services/mirror/deploy.js";
import { evaluatePage } from "../../../services/eval/page-evaluator.js";
import { loadSiteHierarchyDoc, saveSiteHierarchyDoc } from "../../../utils/site-hierarchy-io.js";
import { loadDesignSystemDoc, saveDesignSystemDoc } from "../../../utils/design-system-io.js";
import { saveArtifact } from "../../../utils/pipeline/artifact-store.js";

function makeFastify(stubs: {
  evalRow?: { report: unknown; status: string } | null;
  siteRow?: { uuid: string; workspaceUuid: string; customDomain: string | null } | null;
} = {}): FastifyInstance {
  const chain = (result: unknown, whereCount: number) => {
    let current: unknown = {
      executeTakeFirst: vi.fn().mockResolvedValue(result),
    };
    for (let i = 0; i < whereCount; i++) {
      current = { where: vi.fn().mockReturnValue(current) };
    }
    return { select: vi.fn().mockReturnValue(current) };
  };

  return {
    db: {
      selectFrom: vi.fn()
        .mockReturnValueOnce(chain(stubs.evalRow ?? null, 1))
        .mockReturnValueOnce(chain(stubs.siteRow ?? null, 1)),
    } as unknown as FastifyInstance["db"],
    config: {
      CDN_BASE_URL: "https://cdn.example.com",
      MILO_PREVIEW_DOMAIN: "preview.example.com",
      S3_DEPLOYMENTS_BUCKET: "milo-deployments",
    } as unknown as FastifyInstance["config"],
    log: { info: vi.fn() },
  } as unknown as FastifyInstance;
}

function makeReport(): ReturnType<typeof finalizeReport> {
  return finalizeReport(
    [{
      name: "content",
      score: 72,
      grade: "C",
      status: "failed",
      issues: [{ severity: "critical", category: "content", message: "Hero CTA missing", fix: "Add hero CTA" }],
    }],
    { url: "https://example.com/", path: "/", title: "Home", h1: "Welcome", wordCount: 120, loadTimeMs: 600 },
  );
}

function makeJob(data: {
  workspaceUuid: string;
  siteUuid: string;
  evalUuid: string;
  pageSlug: string;
  remainingAttempts?: number;
}): Job {
  return { id: "job-1", data } as Job;
}

describe("eval-fix worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("loads report, applies fix plan, rebuilds/publishes template, and re-evaluates", async () => {
    const report = makeReport();
    const fastify = makeFastify({
      evalRow: { report, status: "failed" },
      siteRow: { uuid: "site-1", workspaceUuid: "ws-1", customDomain: null },
    });
    const processor = evalFixProcessor(fastify);

    const hierarchy = {
      version: "1",
      siteMetadata: { framework: "astro", mode: "template", generatedAt: "" },
      pages: [{ slug: "index", path: "/", title: "Home", sections: [] }],
      buildPlan: { nextPage: "", pageStatus: {}, buildOrder: ["index"] },
    };
    vi.mocked(loadSiteHierarchyDoc).mockResolvedValue(hierarchy);

    const designSystem = {
      version: "2",
      siteMetadata: { framework: "astro", mode: "template", generatedAt: "" },
      global: { tokens: { colors: {}, fonts: {} }, shell: {}, rules: {} },
      business: {},
      brand: { logo: { type: "text", value: "" }, headingStyle: { uppercase: false, bold: false } },
      reference: {},
    };
    vi.mocked(loadDesignSystemDoc).mockResolvedValue(designSystem);

    const brief = {
      appliedHeals: [{ category: "content", severity: "major", target: "hero.ctaLabel", message: "Added CTA label" }],
      sectionInstructions: [{ sectionId: "hero", instructions: "Ensure the hero CTA is visible and clickable." }],
      globalInstructions: "Keep CTAs above the fold.",
    };
    const healedContent = { meta: {}, business: {}, brand: {}, navigation: {}, pages: { home: {} } };
    vi.mocked(buildFixPlan).mockReturnValue({
      content: healedContent,
      hierarchy,
      designSystem,
      brief,
      changed: true,
    });

    vi.mocked(buildGymJson).mockResolvedValue({
      content: { meta: {}, business: {}, brand: {}, navigation: {}, pages: { home: {} } },
      warnings: [],
    });

    vi.mocked(deployTemplate).mockResolvedValue({
      version: 7,
      deployPrefix: "sites/site-1/deploys/tpl-123",
      routes: 5,
      redirects: [],
    });

    vi.mocked(buildTemplateLocal).mockResolvedValue(undefined);

    vi.mocked(deployTemplateDist).mockResolvedValue({
      version: 7,
      deployPrefix: "sites/site-1/deploys/tpl-123",
      routes: 5,
      redirects: [],
    });

    vi.mocked(promoteDeploy).mockResolvedValue(undefined);

    vi.mocked(publishLatestStagingToProduction).mockResolvedValue({ version: 7 });

    vi.mocked(evaluatePage).mockResolvedValue(
      finalizeReport(
        [{
          name: "content",
          score: 95,
          grade: "A",
          status: "passed",
          issues: [],
        }],
        { url: "https://site-1.preview.example.com/", path: "/", title: "Home", h1: "Welcome", wordCount: 120, loadTimeMs: 600 },
      ),
    );

    const result = await processor(makeJob({ workspaceUuid: "ws-1", siteUuid: "site-1", evalUuid: "eval-1", pageSlug: "index" }));

    expect(loadSiteHierarchyDoc).toHaveBeenCalledWith(fastify.db, "ws-1", "site-1");
    expect(loadDesignSystemDoc).toHaveBeenCalledWith(fastify.db, "ws-1", "site-1");
    expect(buildFixPlan).toHaveBeenCalledWith(expect.objectContaining({ report, pageSlug: "index" }));
    expect(saveSiteHierarchyDoc).toHaveBeenCalledWith(fastify.db, "ws-1", "site-1", hierarchy);
    expect(saveDesignSystemDoc).toHaveBeenCalledWith(fastify.db, "ws-1", "site-1", designSystem);
    expect(saveArtifact).toHaveBeenCalledWith(
      fastify.db,
      { siteUuid: "site-1", workspaceUuid: "ws-1" },
      expect.anything(),
      healedContent,
    );
    expect(deployTemplateDist).toHaveBeenCalledWith(
      expect.objectContaining({
        db: fastify.db,
        siteUuid: "site-1",
        workspaceUuid: "ws-1",
      }),
    );
    expect(publishLatestStagingToProduction).toHaveBeenCalledWith(
      fastify.db,
      expect.any(Object),
      "milo-deployments",
      "site-1",
      undefined,
      undefined,
      "preview.example.com",
    );
    expect(evaluatePage).toHaveBeenCalledWith(
      expect.objectContaining({
        siteUuid: "site-1",
        workspaceUuid: "ws-1",
        path: "/",
        url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/),
      }),
    );
    expect(result).toMatchObject({
      fixed: true,
      pageSlug: "index",
      appliedHeals: 1,
      sectionInstructions: 1,
      published: true,
      templateVersion: 7,
      publishedVersion: 7,
      reEvalStatus: "passed",
      reEvalScore: 95,
    });
  });

  test("returns early when report already passes", async () => {
    const report = finalizeReport(
      [{
        name: "content",
        score: 95,
        grade: "A",
        status: "passed",
        issues: [],
      }],
      { url: "https://example.com/", path: "/", title: "Home", h1: "Welcome", wordCount: 120, loadTimeMs: 600 },
    );
    const fastify = makeFastify({
      evalRow: { report, status: "passed" },
      siteRow: null,
    });
    const processor = evalFixProcessor(fastify);

    const result = await processor(makeJob({ workspaceUuid: "ws-1", siteUuid: "site-1", evalUuid: "eval-1", pageSlug: "index" }));

    expect(loadSiteHierarchyDoc).not.toHaveBeenCalled();
    expect(deployTemplate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      fixed: false,
      pageSlug: "index",
      appliedHeals: 0,
      published: false,
      reEvalStatus: "passed",
    });
  });
});
