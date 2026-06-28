import fp from "fastify-plugin";
import { MembershipRole } from "../../types/db";

declare module "fastify" {
  interface FastifyRequest {
    user: {
      uuid: string;
      email: string;
      name: string | null;
    };
    workspace: {
      uuid: string;
      slug: string;
      name: string;
      organizationUuid: string | null;
    };
    membership: {
      role: MembershipRole;
      via: "workspace" | "organization";
    };
  }
}

function extractToken(header: string | undefined): string | null {
  if (!header) return null;
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return header.trim();
}

export default fp(
  (fastify, _, done) => {
    fastify.addHook("onRequest", (request, reply, hookDone) => {
      const token = extractToken(request.headers.authorization as string | undefined);

      if (!token) {
        reply.code(401).send({ error: "Missing authorization header" });
        return hookDone();
      }

      const slug = request.headers["x-workspace-slug"] as string | undefined;

      if (!slug) {
        reply.code(401).send({ error: "Missing x-workspace-slug header" });
        return hookDone();
      }

      fastify.db
        .selectFrom("users")
        .select(["uuid", "email", "name"])
        .where("externalUserId", "=", token)
        .executeTakeFirst()
        .then((user) => {
          if (!user) {
            reply.code(401).send({ error: "User not found" });
            return hookDone();
          }

          request.user = user;

          return fastify.db
            .selectFrom("workspaces")
            .selectAll()
            .where("slug", "=", slug)
            .where("status", "!=", "cancelled")
            .executeTakeFirst()
            .then(async (workspace) => {
              if (!workspace) {
                reply.code(404).send({ error: "Workspace not found" });
                return hookDone();
              }

              const workspaceMembership = await fastify.db
                .selectFrom("workspaceMemberships")
                .select("role")
                .where("workspaceUuid", "=", workspace.uuid)
                .where("userUuid", "=", user.uuid)
                .executeTakeFirst();

              if (workspaceMembership) {
                request.workspace = {
                  uuid: workspace.uuid,
                  slug: workspace.slug,
                  name: workspace.name,
                  organizationUuid: workspace.organizationUuid,
                };
                request.membership = { role: workspaceMembership.role, via: "workspace" };
                return hookDone();
              }

              if (workspace.organizationUuid) {
                const orgMembership = await fastify.db
                  .selectFrom("organizationMemberships")
                  .select("role")
                  .where("organizationUuid", "=", workspace.organizationUuid)
                  .where("userUuid", "=", user.uuid)
                  .executeTakeFirst();

                if (orgMembership && ["owner", "admin"].includes(orgMembership.role)) {
                  request.workspace = {
                    uuid: workspace.uuid,
                    slug: workspace.slug,
                    name: workspace.name,
                    organizationUuid: workspace.organizationUuid,
                  };
                  request.membership = { role: orgMembership.role, via: "organization" };
                  return hookDone();
                }
              }

              reply.code(403).send({ error: "Access denied to workspace" });
              hookDone();
            });
        })
        .catch((error) => {
          reply.code(500).send({ error: "Failed to resolve workspace membership" });
          hookDone(error);
        });
    });

    done();
  },
  { name: "workspace", dependencies: ["db"] },
);
