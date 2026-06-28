import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createType("membership_role")
    .asEnum(["owner", "admin", "member"])
    .execute();

  await db.schema
    .createTable("users")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("email", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("name", "varchar(255)")
    .addColumn("external_user_id", "varchar(255)")
    .addColumn("avatar_url", "text")
    .addColumn("metadata", "jsonb")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("organizations")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("slug", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("name", "varchar(255)", (col) => col.notNull())
    .addColumn("owner_user_uuid", "uuid", (col) => col.references("users.uuid"))
    .addColumn("metadata", "jsonb")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("organization_memberships")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("organization_uuid", "uuid", (col) =>
      col.notNull().references("organizations.uuid").onDelete("cascade"),
    )
    .addColumn("user_uuid", "uuid", (col) =>
      col.notNull().references("users.uuid").onDelete("cascade"),
    )
    .addColumn("role", sql`membership_role`, (col) => col.notNull().defaultTo("member"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("organization_memberships_unique", [
      "organization_uuid",
      "user_uuid",
    ])
    .execute();

  await db.schema
    .alterTable("workspaces")
    .addColumn("organization_uuid", "uuid", (col) =>
      col.references("organizations.uuid").onDelete("cascade"),
    )
    .execute();

  await db.schema
    .createTable("workspace_memberships")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) =>
      col.notNull().references("workspaces.uuid").onDelete("cascade"),
    )
    .addColumn("user_uuid", "uuid", (col) =>
      col.notNull().references("users.uuid").onDelete("cascade"),
    )
    .addColumn("role", sql`membership_role`, (col) => col.notNull().defaultTo("member"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("workspace_memberships_unique", ["workspace_uuid", "user_uuid"])
    .execute();

  await db.schema
    .createIndex("organization_memberships_user_uuid_idx")
    .on("organization_memberships")
    .column("user_uuid")
    .execute();

  await db.schema
    .createIndex("workspace_memberships_user_uuid_idx")
    .on("workspace_memberships")
    .column("user_uuid")
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("workspace_memberships_user_uuid_idx").execute();
  await db.schema.dropIndex("organization_memberships_user_uuid_idx").execute();

  await db.schema.dropTable("workspace_memberships").execute();
  await db.schema.dropTable("organization_memberships").execute();
  await db.schema.alterTable("workspaces").dropColumn("organization_uuid").execute();
  await db.schema.dropTable("organizations").execute();
  await db.schema.dropTable("users").execute();
  await db.schema.dropType("membership_role").execute();
}
