import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Store the CloudFront distribution domain set at cutover time
  await db.schema
    .alterTable("sites")
    .addColumn("cloudfront_domain", "text")
    .execute();

  // Prevent two sites from claiming the same custom domain (uniqueness enforced
  // only on non-null values so draft sites with no domain don't conflict)
  await sql`
    CREATE UNIQUE INDEX sites_custom_domain_unique_idx
    ON sites (custom_domain)
    WHERE custom_domain IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS sites_custom_domain_unique_idx`.execute(db);
  await db.schema.alterTable("sites").dropColumn("cloudfront_domain").execute();
}
