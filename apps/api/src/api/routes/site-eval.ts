import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { renderMarkdownReport, type PageEvalReport } from "../../services/eval/page-eval-report.js";

const Params = z.object({ siteUuid: z.string().uuid() });
const EvalParams = z.object({ evalUuid: z.string().uuid() });
const ErrorSchema = z.object({ error: z.string() });

const EvalIssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor", "info"]),
  category: z.enum(["accessibility", "seo", "links", "interactivity", "performance", "content", "visual"]),
  message: z.string(),
  fix: z.string().optional(),
  selector: z.string().optional(),
});

const EvalCategorySchema = z.object({
  name: z.enum(["accessibility", "seo", "links", "interactivity", "performance", "content", "visual"]),
  score: z.number().int().min(0).max(100),
  grade: z.string(),
  status: z.enum(["passed", "failed"]),
  issues: z.array(EvalIssueSchema),
});

const EvalMetadataSchema = z.object({
  url: z.string(),
  path: z.string(),
  title: z.string().nullable(),
  h1: z.string().nullable(),
  wordCount: z.number().int(),
  loadTimeMs: z.number().int(),
  screenshotUrl: z.string().nullable().optional(),
});

const EvalActionItemSchema = z.object({
  priority: z.enum(["critical", "major", "minor", "info"]),
  category: z.enum(["accessibility", "seo", "links", "interactivity", "performance", "content", "visual"]),
  message: z.string(),
  fix: z.string(),
  selector: z.string().optional(),
});

const EvalSummarySchema = z.object({
  status: z.enum(["passed", "failed"]),
  score: z.number().int().min(0).max(100),
  grade: z.string(),
  summary: z.string(),
  clientSummary: z.string(),
  actionItems: z.array(EvalActionItemSchema),
});

const EvalReportSchema = z.object({
  overall: EvalSummarySchema,
  categories: z.array(EvalCategorySchema),
  metadata: EvalMetadataSchema,
});

const EvalRowSummarySchema = z.object({
  uuid: z.string(),
  siteUuid: z.string(),
  workspaceUuid: z.string(),
  jobId: z.string().nullable(),
  status: z.string(),
  path: z.string().nullable(),
  score: z.number().nullable(),
  grade: z.string().nullable(),
  issueCount: z.number().nullable(),
  createdAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});

const EnqueueBodySchema = z.object({
  path: z.string().min(1).default("/"),
  url: z.string().url().optional(),
  keywords: z.array(z.string()).optional(),
});

const EnqueueResponseSchema = z.object({
  evalUuid: z.string(),
  jobId: z.string(),
  status: z.literal("queued"),
  path: z.string(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  async function ownedSite(siteUuid: string, workspaceUuid: string) {
    return fastify.db
      .selectFrom("sites")
      .select(["uuid", "sourceUrl", "subdomain", "customDomain", "cloudfrontDomain"])
      .where("uuid", "=", siteUuid)
      .where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
  }

  fastify.post(
    "/sites/:siteUuid/eval",
    {
      schema: {
        operationId: "enqueueSiteEval",
        tags: ["Evals"],
        summary: "Run a QA eval against a single page of a Milo site",
        params: Params,
        body: EnqueueBodySchema,
        response: {
          202: EnqueueResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const workspaceUuid = request.workspace.uuid;
      const site = await ownedSite(siteUuid, workspaceUuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      const { path, url, keywords } = request.body;

      const evalUuid = (await fastify.db
        .insertInto("siteEvals")
        .values({
          siteUuid,
          workspaceUuid,
          status: "queued",
          pages: JSON.stringify([{ path, score: null }]),
        })
        .returning("uuid")
        .executeTakeFirstOrThrow()).uuid;

      const job = await fastify.queues.siteEval.queue.add(
        "site_eval",
        { siteUuid, workspaceUuid, url, evalUuid, path, keywords },
        { jobId: `eval-${siteUuid}-${path.replace(/\//g, "-")}-${Date.now()}` },
      );

      await fastify.db
        .updateTable("siteEvals")
        .set({ jobId: job.id ?? null })
        .where("uuid", "=", evalUuid)
        .execute();

      return reply.code(202).send({ evalUuid, jobId: job.id ?? "", status: "queued", path });
    },
  );

  fastify.get(
    "/sites/:siteUuid/evals",
    {
      schema: {
        operationId: "listSiteEvals",
        tags: ["Evals"],
        summary: "List eval history for a site",
        params: Params,
        response: {
          200: z.object({ evals: z.array(EvalRowSummarySchema) }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const rows = await fastify.db
        .selectFrom("siteEvals")
        .selectAll()
        .where("siteUuid", "=", siteUuid)
        .orderBy("createdAt", "desc")
        .limit(50)
        .execute();

      return {
        evals: rows.map((r) => {
          const pages = (r.pages as Array<{ path?: string; score?: number }>) ?? [];
          const page = pages[0];
          return {
            uuid: r.uuid,
            siteUuid: r.siteUuid,
            workspaceUuid: r.workspaceUuid,
            jobId: r.jobId,
            status: r.status,
            path: page?.path ?? null,
            score: page?.score ?? null,
            grade: (r.formStatus as string)?.split(" ")[1] ?? null,
            issueCount: (r.warnings as string[])?.length ?? null,
            createdAt: r.createdAt,
            completedAt: r.completedAt,
          };
        }),
      };
    },
  );

  fastify.get(
    "/evals/:evalUuid",
    {
      schema: {
        operationId: "getEval",
        tags: ["Evals"],
        summary: "Get full eval report",
        params: EvalParams,
        response: {
          200: EvalReportSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { evalUuid } = request.params;
      const row = await fastify.db
        .selectFrom("siteEvals")
        .selectAll()
        .where("uuid", "=", evalUuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!row) return reply.code(404).send({ error: "Eval not found" });

      if (row.report && typeof row.report === "object" && Object.keys(row.report).length > 0) {
        return row.report as z.infer<typeof EvalReportSchema>;
      }

      // Fallback for rows created before the report column was added
      const pages = (row.pages as Array<{ path?: string; score?: number }>) ?? [];
      const warnings = (row.warnings as string[]) ?? [];
      const page = pages[0];

      const status: "passed" | "failed" = row.status === "passed" ? "passed" : "failed";
      const report: z.infer<typeof EvalReportSchema> = {
        overall: {
          status,
          score: page?.score ?? 0,
          grade: (row.formStatus as string)?.split(" ")[1] ?? "F",
          summary: warnings[0] ?? row.failedReason ?? "",
          clientSummary: warnings[0] ?? row.failedReason ?? "No detailed report is available for this older eval.",
          actionItems: [],
        },
        categories: [],
        metadata: {
          url: "",
          path: page?.path ?? "/",
          title: null,
          h1: null,
          wordCount: 0,
          loadTimeMs: 0,
        },
      };
      return report;
    },
  );

  fastify.get(
    "/evals/:evalUuid/report.md",
    {
      schema: {
        operationId: "getEvalReportMarkdown",
        tags: ["Evals"],
        summary: "Get the eval report as a client-readable Markdown document",
        params: EvalParams,
        response: {
          200: z.string(),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { evalUuid } = request.params;
      const row = await fastify.db
        .selectFrom("siteEvals")
        .selectAll()
        .where("uuid", "=", evalUuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!row) return reply.code(404).send({ error: "Eval not found" });

      const report = (row.report ?? null) as PageEvalReport | null;
      if (!report) {
        return reply.code(404).send({ error: "No report available for this eval" });
      }

      return reply.type("text/markdown; charset=utf-8").send(renderMarkdownReport(report));
    },
  );

  fastify.get(
    "/evals/:evalUuid/status",
    {
      schema: {
        operationId: "getEvalStatus",
        tags: ["Evals"],
        summary: "Lightweight eval status for polling",
        params: EvalParams,
        response: {
          200: EvalRowSummarySchema.omit({ uuid: true, siteUuid: true, workspaceUuid: true, jobId: true, createdAt: true }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { evalUuid } = request.params;
      const row = await fastify.db
        .selectFrom("siteEvals")
        .select(["status", "formStatus", "warnings", "pages", "completedAt"])
        .where("uuid", "=", evalUuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!row) return reply.code(404).send({ error: "Eval not found" });

      const pages = (row.pages as Array<{ path?: string; score?: number }>) ?? [];
      const page = pages[0];
      return {
        status: row.status,
        path: page?.path ?? null,
        score: page?.score ?? null,
        grade: (row.formStatus as string)?.split(" ")[1] ?? null,
        issueCount: ((row.warnings as string[]) ?? []).length,
        completedAt: row.completedAt,
      };
    },
  );

  done();
};

export default app;
