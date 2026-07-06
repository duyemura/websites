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

export interface FormSubmissionOpts {
  /** Called after the lead is persisted, only when site.notifyEmail is set. */
  enqueueNotify?: (leadUuid: string, siteUuid: string) => Promise<void>;
}

function normalizeFields(fields: Record<string, unknown>): {
  email: string | null;
  phone: string | null;
  name: string | null;
} {
  const find = (pattern: RegExp): string | null => {
    for (const [key, val] of Object.entries(fields)) {
      if (pattern.test(key.toLowerCase()) && typeof val === "string" && val.trim()) {
        return val.trim();
      }
    }
    return null;
  };
  return {
    email: find(/email/),
    phone: find(/phone|mobile|tel/),
    name: find(/^(full[-_]?name|your[-_]?name|name|first[-_]?name)$/),
  };
}

export async function handleFormSubmission(
  db: Kysely<DB>,
  submission: FormSubmission,
  opts: FormSubmissionOpts = {},
): Promise<{ stored: boolean }> {
  const hp = submission.fields["_hp"];
  if (typeof hp === "string" && hp.length > 0) return { stored: false };

  const site = await db
    .selectFrom("sites")
    .select(["uuid", "workspaceUuid", "notifyEmail"])
    .where("uuid", "=", submission.siteUuid)
    .executeTakeFirst();
  if (!site) return { stored: false };

  const { _hp, ...fields } = submission.fields;
  void _hp;
  const { email, phone, name } = normalizeFields(fields);

  const lead = await db
    .insertInto("leads")
    .values({
      siteUuid: site.uuid,
      workspaceUuid: site.workspaceUuid,
      formId: submission.formId,
      fields: jsonb(fields),
      sourcePath: submission.sourcePath,
      ip: submission.ip,
      email,
      phone,
      name,
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();

  if (site.notifyEmail && opts.enqueueNotify) {
    try {
      await opts.enqueueNotify(lead.uuid, site.uuid);
    } catch (err) {
      // Notification failure must not lose a stored lead
      console.error("lead notify enqueue failed", { leadUuid: lead.uuid, err });
    }
  }

  return { stored: true };
}

export interface LeadPage {
  leads: {
    uuid: string;
    formId: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    sourcePath: string | null;
    fields: unknown;
    createdAt: Date;
  }[];
  total: number;
  page: number;
  limit: number;
}

export async function listLeads(
  db: Kysely<DB>,
  opts: { siteUuid: string; workspaceUuid: string; page: number; limit: number; formId?: string },
): Promise<LeadPage> {
  const page = Math.max(1, opts.page);
  const limit = Math.max(1, Math.min(opts.limit, 100));

  let q = db
    .selectFrom("leads")
    .where("siteUuid", "=", opts.siteUuid)
    .where("workspaceUuid", "=", opts.workspaceUuid);

  if (opts.formId) q = q.where("formId", "=", opts.formId);

  const [rows, countRow] = await Promise.all([
    q
      .select(["uuid", "formId", "email", "phone", "name", "sourcePath", "fields", "createdAt"])
      .orderBy("createdAt", "desc")
      .limit(limit)
      .offset((page - 1) * limit)
      .execute(),
    q.select(({ fn }) => [fn.countAll<string>().as("n")]).executeTakeFirstOrThrow(),
  ]);

  return {
    leads: rows.map((r) => ({
      uuid: r.uuid,
      formId: r.formId,
      email: r.email,
      phone: r.phone,
      name: r.name,
      sourcePath: r.sourcePath,
      fields: r.fields,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    })),
    total: Number(countRow.n),
    page,
    limit,
  };
}
