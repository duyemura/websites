import fp from "fastify-plugin";
import { verifyToken } from "@clerk/backend";
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

async function verifyBearerToken(
  token: string,
  config: { secretKey?: string; verify: boolean },
): Promise<string | null> {
  if (!config.verify) {
    return token;
  }

  if (!config.secretKey) {
    return null;
  }

  try {
    const result = await verifyToken(token, { secretKey: config.secretKey });
    return result.sub ?? null;
  } catch {
    return null;
  }
}

export default fp(
  async (fastify) => {
    const config = fastify.config;

    fastify.addHook("onRequest", async (request, reply) => {
      const token = extractToken(request.headers.authorization as string | undefined);

      if (!token) {
        return reply.code(401).send({ error: "Missing authorization header" });
      }

      const slug = request.headers["x-workspace-slug"] as string | undefined;

      if (!slug) {
        return reply.code(401).send({ error: "Missing x-workspace-slug header" });
      }

      const externalUserId = await verifyBearerToken(token, {
        secretKey: config.CLERK_SECRET_KEY,
        verify: config.CLERK_VERIFY_TOKENS,
      });

      if (!externalUserId) {
        return reply.code(401).send({ error: "Invalid authorization token" });
      }

      const user = await fastify.db
        .selectFrom("users")
        .select(["uuid", "email", "name"])
        .where("externalUserId", "=", externalUserId)
        .executeTakeFirst();

      if (!user) {
        return reply.code(401).send({ error: "User not found" });
      }

      request.user = user;

      const workspace = await fastify.db
        .selectFrom("workspaces")
        .selectAll()
        .where("slug", "=", slug)
        .where("status", "!=", "cancelled")
        .executeTakeFirst();

      if (!workspace) {
        return reply.code(404).send({ error: "Workspace not found" });
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
        return;
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
          return;
        }
      }

      return reply.code(403).send({ error: "Access denied to workspace" });
    });
  },
  { name: "workspace", dependencies: ["db"] },
);
