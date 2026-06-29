import { Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`.execute(db);

  // Workspaces
  await db.schema
    .createType("workspace_status")
    .asEnum(["active", "suspended", "trial", "cancelled"])
    .execute();

  await db.schema
    .createTable("workspaces")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("slug", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("name", "varchar(255)", (col) => col.notNull())
    .addColumn("owner_user_id", "varchar(255)")
    .addColumn("brand_primary_color", "varchar(50)")
    .addColumn("brand_font_heading", "varchar(100)")
    .addColumn("brand_font_body", "varchar(100)")
    .addColumn("metadata", "jsonb")
    .addColumn("status", sql`workspace_status`, (col) => col.notNull().defaultTo("active"))
    .addColumn("external_ids", "jsonb")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Themes
  await db.schema
    .createType("theme_source")
    .asEnum(["system_preset", "user_selected", "ai_generated", "replicated"])
    .execute();

  await db.schema
    .createTable("themes")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) => col.references("workspaces.uuid").onDelete("cascade"))
    .addColumn("name", "varchar(255)", (col) => col.notNull())
    .addColumn("template_key", "varchar(255)")
    .addColumn("tokens", "jsonb", (col) => col.notNull())
    .addColumn("source", sql`theme_source`, (col) => col.notNull().defaultTo("system_preset"))
    .addColumn("parent_theme_uuid", "uuid")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Sites
  await db.schema
    .createType("site_status")
    .asEnum(["draft", "published", "archived"])
    .execute();

  await db.schema
    .createTable("sites")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) => col.notNull().references("workspaces.uuid").onDelete("cascade"))
    .addColumn("slug", "varchar(255)", (col) => col.notNull())
    .addColumn("name", "varchar(255)", (col) => col.notNull())
    .addColumn("subdomain", "varchar(255)")
    .addColumn("custom_domain", "varchar(255)")
    .addColumn("status", sql`site_status`, (col) => col.notNull().defaultTo("draft"))
    .addColumn("theme_uuid", "uuid", (col) => col.references("themes.uuid"))
    .addColumn("default_meta_title", "varchar(255)")
    .addColumn("default_meta_description", "text")
    .addColumn("favicon_url", "text")
    .addColumn("og_image_url", "text")
    .addColumn("schema_json", "jsonb")
    .addColumn("integrations", "jsonb")
    .addColumn("published_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("sites_workspace_slug_unique", ["workspace_uuid", "slug"])
    .execute();

  // Pages
  await db.schema
    .createType("page_status")
    .asEnum(["draft", "published", "archived"])
    .execute();

  await db.schema
    .createTable("pages")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("site_uuid", "uuid", (col) => col.notNull().references("sites.uuid").onDelete("cascade"))
    .addColumn("title", "varchar(255)", (col) => col.notNull())
    .addColumn("slug", "varchar(255)", (col) => col.notNull())
    .addColumn("is_home_page", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("meta_title", "varchar(255)")
    .addColumn("meta_description", "text")
    .addColumn("canonical_url", "text")
    .addColumn("robots", "varchar(50)")
    .addColumn("og_image_url", "text")
    .addColumn("schema_json", "jsonb")
    .addColumn("sections", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("status", sql`page_status`, (col) => col.notNull().defaultTo("draft"))
    .addColumn("published_at", "timestamptz")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("pages_site_slug_unique", ["site_uuid", "slug"])
    .execute();

  // Docs
  await db.schema
    .createType("doc_source")
    .asEnum(["manual", "ai_extracted", "imported"])
    .execute();

  await db.schema
    .createTable("docs")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) => col.notNull().references("workspaces.uuid").onDelete("cascade"))
    .addColumn("key", "varchar(100)", (col) => col.notNull())
    .addColumn("title", "varchar(255)", (col) => col.notNull())
    .addColumn("content", "text")
    .addColumn("content_json", "jsonb")
    .addColumn("source", sql`doc_source`, (col) => col.notNull().defaultTo("manual"))
    .addColumn("embedding", sql`vector(1536)`)
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("docs_workspace_key_unique", ["workspace_uuid", "key"])
    .execute();

  // Assets
  await db.schema
    .createType("asset_type")
    .asEnum(["image", "video", "font", "document", "logo", "icon"])
    .execute();

  await db.schema
    .createTable("assets")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) => col.notNull().references("workspaces.uuid").onDelete("cascade"))
    .addColumn("name", "varchar(255)", (col) => col.notNull())
    .addColumn("type", sql`asset_type`, (col) => col.notNull())
    .addColumn("mime_type", "varchar(100)")
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("storage_key", "text", (col) => col.notNull())
    .addColumn("metadata", "jsonb")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Templates
  await db.schema
    .createTable("templates")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) => col.references("workspaces.uuid").onDelete("cascade"))
    .addColumn("key", "varchar(255)", (col) => col.notNull())
    .addColumn("name", "varchar(255)", (col) => col.notNull())
    .addColumn("category", "varchar(100)")
    .addColumn("thumbnail_url", "text")
    .addColumn("theme", "jsonb")
    .addColumn("page", "jsonb")
    .addColumn("is_system", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("tags", sql`text[]`)
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("templates_workspace_key_unique", ["workspace_uuid", "key"])
    .execute();

  // Playbooks
  await db.schema
    .createTable("playbooks")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) => col.references("workspaces.uuid").onDelete("cascade"))
    .addColumn("key", "varchar(255)", (col) => col.notNull())
    .addColumn("name", "varchar(255)", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("category", "varchar(100)")
    .addColumn("thumbnail_url", "text")
    .addColumn("input_schema", "jsonb")
    .addColumn("steps", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("is_system", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("playbooks_workspace_key_unique", ["workspace_uuid", "key"])
    .execute();

  // Deployments
  await db.schema
    .createType("deployment_status")
    .asEnum(["pending", "building", "success", "failed"])
    .execute();

  await db.schema
    .createTable("deployments")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("site_uuid", "uuid", (col) => col.notNull().references("sites.uuid").onDelete("cascade"))
    .addColumn("build_id", "varchar(255)", (col) => col.notNull().unique())
    .addColumn("status", sql`deployment_status`, (col) => col.notNull().defaultTo("pending"))
    .addColumn("artifact_url", "text")
    .addColumn("metadata", "jsonb")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // AI jobs
  await db.schema
    .createType("ai_job_type")
    .asEnum(["generate_page", "replicate_site", "run_playbook", "generate_assets"])
    .execute();

  await db.schema
    .createType("ai_job_status")
    .asEnum(["pending", "running", "completed", "failed", "cancelled"])
    .execute();

  await db.schema
    .createTable("ai_jobs")
    .addColumn("uuid", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("workspace_uuid", "uuid", (col) => col.notNull().references("workspaces.uuid").onDelete("cascade"))
    .addColumn("site_uuid", "uuid", (col) => col.references("sites.uuid").onDelete("cascade"))
    .addColumn("type", sql`ai_job_type`, (col) => col.notNull())
    .addColumn("status", sql`ai_job_status`, (col) => col.notNull().defaultTo("pending"))
    .addColumn("input", "jsonb")
    .addColumn("output", "jsonb")
    .addColumn("playbook_uuid", "uuid", (col) => col.references("playbooks.uuid").onDelete("set null"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("ai_jobs").execute();
  await db.schema.dropType("ai_job_type").execute();
  await db.schema.dropType("ai_job_status").execute();

  await db.schema.dropTable("deployments").execute();
  await db.schema.dropType("deployment_status").execute();

  await db.schema.dropTable("playbooks").execute();
  await db.schema.dropTable("templates").execute();

  await db.schema.dropTable("assets").execute();
  await db.schema.dropType("asset_type").execute();

  await db.schema.dropTable("docs").execute();
  await db.schema.dropType("doc_source").execute();

  await db.schema.dropTable("pages").execute();
  await db.schema.dropType("page_status").execute();

  await db.schema.dropTable("sites").execute();
  await db.schema.dropType("site_status").execute();

  await db.schema.dropTable("themes").execute();
  await db.schema.dropType("theme_source").execute();

  await db.schema.dropTable("workspaces").execute();
  await db.schema.dropType("workspace_status").execute();
}
