import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const OrganizationSchema = z.object({
  uuid: z.string(),
  slug: z.string(),
  name: z.string(),
  ownerUserUuid: z.string().nullable().optional(),
  metadata: z.any().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateOrganizationSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

const MembershipSchema = z.object({
  uuid: z.string(),
  organizationUuid: z.string(),
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
    "/organizations",
    {
      schema: {
        response: { 200: z.array(OrganizationSchema) },
      },
    },
    async (request) => {
      const orgs = await fastify.db
        .selectFrom("organizations")
        .innerJoin("organizationMemberships", "organizationMemberships.organizationUuid", "organizations.uuid")
        .selectAll("organizations")
        .where("organizationMemberships.userUuid", "=", request.user.uuid)
        .orderBy("organizations.createdAt", "desc")
        .execute();

      return orgs.map((org) => ({
        ...org,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/organizations",
    {
      schema: {
        body: CreateOrganizationSchema,
        response: { 201: OrganizationSchema, 409: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const existing = await fastify.db
        .selectFrom("organizations")
        .select("uuid")
        .where("slug", "=", request.body.slug)
        .executeTakeFirst();

      if (existing) {
        return reply.code(409).send({ error: "Organization slug is already in use." });
      }

      const org = await fastify.db
        .insertInto("organizations")
        .values({
          slug: request.body.slug,
          name: request.body.name,
          ownerUserUuid: request.user.uuid,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await fastify.db
        .insertInto("organizationMemberships")
        .values({
          organizationUuid: org.uuid,
          userUuid: request.user.uuid,
          role: "owner",
        })
        .execute();

      return reply.code(201).send({
        ...org,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
      });
    },
  );

  fastify.get(
    "/organizations/:uuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 200: OrganizationSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const org = await fastify.db
        .selectFrom("organizations")
        .selectAll()
        .where("uuid", "=", request.params.uuid)
        .executeTakeFirst();

      if (!org) {
        return reply.code(404).send({ error: "Organization not found" });
      }

      return {
        ...org,
        createdAt: org.createdAt.toISOString(),
        updatedAt: org.updatedAt.toISOString(),
      };
    },
  );

  fastify.get(
    "/organizations/:uuid/members",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 200: z.array(MembershipSchema) },
      },
    },
    async (request) => {
      const memberships = await fastify.db
        .selectFrom("organizationMemberships")
        .innerJoin("users", "users.uuid", "organizationMemberships.userUuid")
        .select([
          "organizationMemberships.uuid",
          "organizationMemberships.organizationUuid",
          "organizationMemberships.userUuid",
          "organizationMemberships.role",
          "organizationMemberships.createdAt",
          "organizationMemberships.updatedAt",
          "users.email",
          "users.name",
        ])
        .where("organizationMemberships.organizationUuid", "=", request.params.uuid)
        .orderBy("organizationMemberships.createdAt", "desc")
        .execute();

      return memberships.map((m) => ({
        uuid: m.uuid,
        organizationUuid: m.organizationUuid,
        userUuid: m.userUuid,
        user: { email: m.email, name: m.name },
        role: m.role,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/organizations/:uuid/members",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        body: AddMemberSchema,
        response: { 201: MembershipSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const org = await fastify.db
        .selectFrom("organizations")
        .select("uuid")
        .where("uuid", "=", request.params.uuid)
        .executeTakeFirst();

      if (!org) {
        return reply.code(404).send({ error: "Organization not found" });
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
        .insertInto("organizationMemberships")
        .values({
          organizationUuid: request.params.uuid,
          userUuid: user.uuid,
          role: request.body.role,
        })
        .onConflict((oc) =>
          oc.constraint("organization_memberships_unique").doUpdateSet({
            role: request.body.role,
            updatedAt: new Date(),
          }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return reply.code(201).send({
        uuid: membership.uuid,
        organizationUuid: membership.organizationUuid,
        userUuid: membership.userUuid,
        user: { email: user.email, name: user.name },
        role: membership.role,
        createdAt: membership.createdAt.toISOString(),
        updatedAt: membership.updatedAt.toISOString(),
      });
    },
  );

  done();
};

export default app;
