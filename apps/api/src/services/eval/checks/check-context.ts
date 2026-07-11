// apps/api/src/services/eval/checks/check-context.ts
// Context passed to every per-page evaluator check.

import type { Page, Browser } from "playwright";
import type { GymSiteContent } from "@ploy-gyms/shared-types";
import type { Kysely } from "kysely";
import type { DB } from "../../../types/db";

export interface CheckContext {
  /** Live Playwright page instance, already navigated to the target URL. */
  page: Page;
  /** Shared browser (in case a check needs a fresh page). */
  browser: Browser;
  /** Public URL that was loaded. */
  url: string;
  /** Path portion relative to site origin. */
  path: string;
  /** Loaded gym.json content, if available. */
  content?: GymSiteContent;
  /** Optional keywords/target phrases to check against. */
  keywords?: string[];
  /** Kysely DB handle (for form smoke tests, etc.). */
  db: Kysely<DB>;
  /** Site UUID. */
  siteUuid: string;
  /** Workspace UUID. */
  workspaceUuid: string;
  /** Logger. */
  log: (msg: string) => void;
}
