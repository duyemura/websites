export interface ApiConfig {
  baseUrl: string;
  token: string;
  workspaceSlug: string;
}

export interface Site {
  uuid: string;
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  mode?: "replication" | "template" | "greenfield" | null;
  sourceUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Doc {
  uuid: string;
  key: string;
  title: string;
  content?: string | null;
}

export interface AiJob {
  uuid: string;
  type: string;
  status: string;
  state?: Record<string, unknown> | null;
  options?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  uuid: string;
  buildId: string;
  status: string;
  previewUrl?: string | null;
  artifactUrl?: string | null;
  createdAt: string;
}

export interface Page {
  uuid: string;
  slug: string;
  title: string;
  status: string;
  isHomePage: boolean;
}

function headers(config: ApiConfig) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.token}`,
    "x-workspace-slug": config.workspaceSlug,
  };
}

function fullUrl(config: ApiConfig, path: string) {
  return `${config.baseUrl.replace(/\/$/, "")}/api${path}`;
}

async function handle<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

export async function scrapeSite(
  config: ApiConfig,
  url: string,
  name?: string,
): Promise<{ site: Site; docs: Doc[]; screenshotAsset?: { url: string } | null }> {
  const response = await fetch(fullUrl(config, "/sites/scrape"), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ url, name }),
  });
  return handle(response);
}

export async function listSites(config: ApiConfig): Promise<Site[]> {
  const response = await fetch(fullUrl(config, "/sites"), {
    headers: headers(config),
  });
  return handle(response);
}

export async function generateSite(
  config: ApiConfig,
  siteUuid: string,
  opts: {
    accuracy?: "fast" | "balanced" | "accurate";
    maxQaIterations?: number;
    maxBudgetUsd?: number;
    fidelityThreshold?: number;
    mode?: "replication" | "template" | "greenfield";
  } = {},
): Promise<{ aiJobUuid: string; attemptId: string; status: string }> {
  const response = await fetch(fullUrl(config, `/sites/${siteUuid}/generate`), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(opts),
  });
  return handle(response);
}

export async function approvePage(
  config: ApiConfig,
  siteUuid: string,
  slug: string,
): Promise<{ approved: string; remainingPagesEnqueued: string[] }> {
  const response = await fetch(fullUrl(config, `/sites/${siteUuid}/pages/${slug}/approve`), {
    method: "POST",
    headers: headers(config),
  });
  return handle(response);
}

export async function listDeployments(config: ApiConfig, siteUuid: string): Promise<Deployment[]> {
  const response = await fetch(fullUrl(config, `/sites/${siteUuid}/deployments`), {
    headers: headers(config),
  });
  if (response.status === 404) return [];
  return handle(response);
}

export async function listAiJobs(config: ApiConfig, siteUuid: string): Promise<AiJob[]> {
  const response = await fetch(
    fullUrl(config, `/ai-activity?siteUuid=${siteUuid}&limit=20`),
    {
      headers: headers(config),
    },
  );
  if (response.status === 404) return [];
  const data = (await response.json()) as { activities?: AiJob[] };
  return data.activities ?? [];
}

export async function listPages(config: ApiConfig, siteUuid: string): Promise<Page[]> {
  // Pages endpoint doesn't exist yet; fallback to empty.
  return [];
}

export function previewUrl(config: ApiConfig, siteUuid: string, attemptId: string): string {
  return fullUrl(config, `/sites/${siteUuid}/preview/${attemptId}`);
}
