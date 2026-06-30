import type { Kysely } from "kysely";
import type { DB } from "../types/db";

export async function getJobCostUsd(
  db: Kysely<DB>,
  aiJobUuid: string,
): Promise<number> {
  const result = await db
    .selectFrom("aiActivity")
    .select((eb) => eb.fn.sum("costUsd").as("totalCostUsd"))
    .where("aiJobUuid", "=", aiJobUuid)
    .executeTakeFirst();

  return Number(result?.totalCostUsd ?? 0);
}

export function wouldExceedBudget(
  spentUsd: number,
  nextEstimateUsd: number,
  maxBudgetUsd?: number | null,
): boolean {
  if (!maxBudgetUsd || maxBudgetUsd <= 0) return false;
  return spentUsd + nextEstimateUsd > maxBudgetUsd;
}
