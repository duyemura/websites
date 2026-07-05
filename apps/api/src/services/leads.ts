import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import { jsonb } from "../utils/jsonb";

export interface FormSubmission {
  siteUuid: string;
  formId: string;
  fields: Record<string, unknown>;
  sourcePath: string | null;
  ip: string | null;
}

export async function handleFormSubmission(
  db: Kysely<DB>,
  submission: FormSubmission,
): Promise<{ stored: boolean }> {
  const hp = submission.fields["_hp"];
  if (typeof hp === "string" && hp.length > 0) return { stored: false };

  const site = await db.selectFrom("sites")
    .select(["uuid", "workspaceUuid"])
    .where("uuid", "=", submission.siteUuid)
    .executeTakeFirst();
  if (!site) return { stored: false };

  const { _hp, ...fields } = submission.fields;
  void _hp;
  await db.insertInto("leads").values({
    siteUuid: site.uuid,
    workspaceUuid: site.workspaceUuid,
    formId: submission.formId,
    fields: jsonb(fields),
    sourcePath: submission.sourcePath,
    ip: submission.ip,
  }).execute();
  return { stored: true };
}
