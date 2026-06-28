import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const WorkspaceSchema = z.object({
  uuid: z.string(),
  slug: z.string(),
  name: z.string(),
  organizationUuid: z.string().nullable().optional(),
  brandPrimaryColor: z.string().nullable().optional(),
  brandFontHeading: z.string().nullable().optional(),
  brandFontBody: z.string().nullable().optional(),
  metadata: z.any().nullable().optional(),
  status: z.enum(["active", "suspended", "trial", "cancelled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  organizationUuid: z.string().uuid().optional(),
});

const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).optional(),
  brandPrimaryColor: z.string().optional(),
  brandFontHeading: z.string().optional(),
  brandFontBody: z.string().optional(),
  status: z.enum(["active", "suspended", "trial", "cancelled"]).optional(),
});

const MembershipSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  userUuid: z.string(),
  user: z.object({
    email: z.string(),
    name: z.string().nullable(),
  }),
  role: z.enum(["owner", "admin", "member"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const AddMemberSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(["owner", "admin", "member"]).default("member"),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/workspaces/me",
    {
      schema: {
        response: { 200: WorkspaceSchema },
      },
    },
    async (request) => {
      const workspace = await fastify.db
        .selectFrom("workspaces")
        .selectAll()
        .where("uuid", "=", request.workspace.uuid)
        .executeTakeFirstOrThrow();

      return {
        ...workspace,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      };
    },
  );

  fastify.get(
    "/workspaces",
    {
      schema: {
        response: { 200: z.array(WorkspaceSchema) },
      },
    },
    async (request) => {
      const workspaces = await fastify.db
        .selectFrom("workspaces")
        .innerJoin("workspaceMemberships", "workspaceMemberships.workspaceUuid", "workspaces.uuid")
        .selectAll("workspaces")
        .where("workspaceMemberships.userUuid", "=", request.user.uuid)
        .where("workspaces.status", "!=", "cancelled")
        .orderBy("workspaces.createdAt", "desc")
        .execute();

      return workspaces.map((ws) => ({
        ...ws,
        createdAt: ws.createdAt.toISOString(),
        updatedAt: ws.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/workspaces",
    {
      schema: {
        body: CreateWorkspaceSchema,
        response: { 201: WorkspaceSchema, 409: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const existing = await fastify.db
        .selectFrom("workspaces")
        .select("uuid")
        .where("slug", "=", request.body.slug)
        .executeTakeFirst();

      if (existing) {
        return reply.code(409).send({ error: "Workspace slug is already in use." });
      }

      const orgUuid = request.body.organizationUuid ?? request.workspace.organizationUuid;

      const workspace = await fastify.db
        .insertInto("workspaces")
        .values({
          slug: request.body.slug,
          name: request.body.name,
          organizationUuid: orgUuid ?? null,
          ownerUserId: request.user.uuid,
          status: "active",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await fastify.db
        .insertInto("workspaceMemberships")
        .values({
          workspaceUuid: workspace.uuid,
          userUuid: request.user.uuid,
          role: "owner",
        })
        .execute();

      return reply.code(201).send({
        ...workspace,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      });
    },
  );

  fastify.get(
    "/workspaces/:uuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 200: WorkspaceSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const workspace = await fastify.db
        .selectFrom("workspaces")
        .selectAll()
        .where("uuid", "=", request.params.uuid)
        .executeTakeFirst();

      if (!workspace) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      return {
        ...workspace,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      };
    },
  );

  fastify.put(
    "/workspaces/:uuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        body: UpdateWorkspaceSchema,
        response: { 200: WorkspaceSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const update = request.body;
      const workspace = await fastify.db
        .updateTable("workspaces")
        .set({ ...update, updatedAt: new Date() })
        .where("uuid", "=", request.params.uuid)
        .where("status", "!=", "cancelled")
        .returningAll()
        .executeTakeFirst();

      if (!workspace) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      return {
        ...workspace,
        createdAt: workspace.createdAt.toISOString(),
        updatedAt: workspace.updatedAt.toISOString(),
      };
    },
  );

  fastify.get(
    "/workspaces/:uuid/members",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 200: z.array(MembershipSchema) },
      },
    },
    async (request) => {
      const memberships = await fastify.db
        .selectFrom("workspaceMemberships")
        .innerJoin("users", "users.uuid", "workspaceMemberships.userUuid")
        .select([
          "workspaceMemberships.uuid",
          "workspaceMemberships.workspaceUuid",
          "workspaceMemberships.userUuid",
          "workspaceMemberships.role",
          "workspaceMemberships.createdAt",
          "workspaceMemberships.updatedAt",
          "users.email",
          "users.name",
        ])
        .where("workspaceMemberships.workspaceUuid", "=", request.params.uuid)
        .orderBy("workspaceMemberships.createdAt", "desc")
        .execute();

      return memberships.map((m) => ({
        uuid: m.uuid,
        workspaceUuid: m.workspaceUuid,
        userUuid: m.userUuid,
        user: { email: m.email, name: m.name },
        role: m.role,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/workspaces/:uuid/members",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        body: AddMemberSchema,
        response: { 201: MembershipSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const workspace = await fastify.db
        .selectFrom("workspaces")
        .select("uuid")
        .where("uuid", "=", request.params.uuid)
        .executeTakeFirst();

      if (!workspace) {
        return reply.code(404).send({ error: "Workspace not found" });
      }

      let user = await fastify.db
        .selectFrom("users")
        .selectAll()
        .where("email", "=", request.body.email)
        .executeTakeFirst();

      if (!user) {
        user = await fastify.db
          .insertInto("users")
          .values({
            email: request.body.email,
            name: request.body.name ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      const membership = await fastify.db
        .insertInto("workspaceMemberships")
        .values({
          workspaceUuid: request.params.uuid,
          userUuid: user.uuid,
          role: request.body.role,
        })
        .onConflict((oc) =>
          oc.constraint("workspace_memberships_unique").doUpdateSet({
            role: request.body.role,
            updatedAt: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return reply.code(201).send({
        uuid: membership.uuid,
        workspaceUuid: membership.workspaceUuid,
        userUuid: membership.userUuid,
        user: { email: user.email, name: user.name },
        role: membership.role,
        createdAt: membership.createdAt.toISOString(),
        updatedAt: membership.updatedAt.toISOString(),
      });
    },
  );

  fastify.delete(
    "/workspaces/:uuid/members/:userUuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid(), userUuid: z.string().uuid() }),
        response: { 204: z.object({}).openapi({ type: "object" }) },
      },
    },
    async (request, reply) => {
      await fastify.db
        .deleteFrom("workspaceMemberships")
        .where("workspaceUuid", "=", request.params.uuid)
        .where("userUuid", "=", request.params.userUuid)
        .execute();

      return reply.code(204).send({});
    },
  );

  done();
};

export default app;
