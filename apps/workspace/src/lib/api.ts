import { getActiveWorkspaceSlug } from "./workspace";
import type {
  TemplateShellPage,
  TemplateShellPlaceholder,
  ThemeTokens,
} from "@milo/shared-types";

const API_BASE = "/api";

let authTokenGetter: (() => Promise<string | null | undefined>) | null = null;

export function setAuthTokenGetter(
  getter: () => Promise<string | null | undefined>,
) {
  authTokenGetter = getter;
}

export async function getAuthToken(): Promise<string | null> {
  if (authTokenGetter) {
    const token = await authTokenGetter();
    if (token) return token;
  }

  if (import.meta.env.DEV) {
    return "local-dev-user";
  }

  return null;
}

async function fetchWithBase(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const hasBody = options.body !== undefined;
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    "x-workspace-slug": getActiveWorkspaceSlug(),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body || response.statusText}`);
  }

  return response;
}

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetchWithBase(path, options);
  return response.json() as Promise<T>;
}

export interface Site {
  uuid: string;
  workspaceUuid: string;
  slug: string;
  name: string;
  status: "draft" | "published" | "archived";
  mode?: "replication" | "template" | "greenfield" | null;
  tier?: "free" | "paid" | null;
  subdomain?: string | null;
  customDomain?: string | null;
  themeUuid?: string | null;
  sourceUrl?: string | null;
  previewUrl?: string | null;
  productionUrl?: string | null;
  defaultMetaTitle?: string | null;
  defaultMetaDescription?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SiteVersion {
  uuid: string;
  siteUuid: string;
  workspaceUuid: string;
  version: number;
  kind: string;
  deployPrefix: string;
  label: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface Doc {
  uuid: string;
  workspaceUuid: string;
  siteUuid?: string | null;
  key: string;
  title: string;
  content?: string | null;
  source: "manual" | "ai_extracted" | "imported";
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export interface AssetAnalysis {
  analyzedAt: string;
  model: string;
  version: number;
  description: string;
  altText: string;
  context:
    | "hero"
    | "logo"
    | "icon"
    | "testimonial"
    | "program"
    | "class"
    | "blog"
    | "social"
    | "background"
    | "other";
  confidence: number;
  tags: string[];
  technical: {
    hasText: boolean;
    textConfidence: number;
    faces?: number | null;
    people?: number | null;
  };
  quality: {
    score: number;
    resolution: "low" | "medium" | "high" | "unknown";
    sharpness: "blurry" | "soft" | "good" | "sharp" | "unknown";
    issues: string[];
  };
  marketing: {
    mood: string;
    useCases: string[];
    subject: string;
    brandFit?: number | null;
  };
  safety: {
    hasIdentifiablePeople: boolean;
    needsReview: boolean;
  };
}

export interface AssetMetadata {
  filename?: string;
  description?: string;
  tags?: string[];
  size?: number;
  dimensions?: { width: number; height: number };
  analysis?: AssetAnalysis;
}

export interface Asset {
  uuid: string;
  workspaceUuid: string;
  name: string;
  type: "image" | "video" | "font" | "document" | "logo" | "icon";
  mimeType?: string | null;
  source: "upload" | "scraped" | "screenshot" | "ai_generated";
  url: string;
  signedUrl: string;
  storageKey: string;
  metadata?: AssetMetadata | null;
  createdAt: string;
}

export interface Template {
  uuid: string;
  workspaceUuid?: string | null;
  key: string;
  name: string;
  category?: string | null;
  thumbnailUrl?: string | null;
  isSystem: boolean;
  tags?: string[] | null;
  instructions?: string | null;
  sourceUrl?: string | null;
  theme?: ThemeTokens | null;
  page?: TemplateShellPage | null;
  placeholders?: TemplateShellPlaceholder[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface Playbook {
  uuid: string;
  workspaceUuid?: string | null;
  key: string;
  name: string;
  description?: string | null;
  category?: string | null;
  thumbnailUrl?: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UploadUrl {
  signedUrl: string;
  publicUrl: string;
  storageKey: string;
}

export interface ScrapeSiteResult {
  site: Site;
  docs: Doc[];
  screenshotAsset?: { uuid: string; url: string; storageKey: string } | null;
}

export interface AiActivityResponse {
  activities: {
    uuid: string;
    workspaceUuid: string;
    siteUuid: string | null;
    userUuid: string;
    aiJobUuid: string | null;
    actionType: string;
    model: string | null;
    provider: string | null;
    promptTemplateKeys: string | null;
    inputDocKeys: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    latencyMs: number | null;
    outcome: string;
    fidelityScore: number | null;
    summary: string;
    errorMessage: string | null;
    userCorrection: string | null;
    metadata: unknown;
    createdAt: string;
  }[];
  summary: { totalCostUsd: number; totalTokens: number; count: number };
}

export type CreateAssetBody = Omit<
  Asset,
  "uuid" | "workspaceUuid" | "createdAt" | "signedUrl" | "mimeType"
> & {
  mimeType?: string;
};

export interface PipelineStageStatus {
  version: number;
  createdAt: string;
  stale: boolean;
}

export interface PipelineStatus {
  stages: {
    extract: PipelineStageStatus | null;
    segment: PipelineStageStatus | null;
    contract: PipelineStageStatus | null;
    docgen: PipelineStageStatus | null;
    build: PipelineStageStatus | null;
    verify: PipelineStageStatus | null;
  };
  scores: {
    mechanicalFidelity: number;
    visualFidelity: number;
    masterFidelity: number;
  } | null;
}

export interface PipelineArtifact {
  version: number;
  createdAt: string;
  payload: unknown;
}

export interface PipelineFieldOption {
  label: string;
  value: string;
}

export interface PipelineField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "multiselect" | "boolean" | "uuid";
  required: boolean;
  options?: PipelineFieldOption[];
  hint?: string;
  dependsOn?: { key: string; value: string };
}

export interface PipelineOptions {
  stages: string[];
  modes: string[];
  fields: PipelineField[];
}

export interface CreateSiteBody {
  name?: string;
  slug?: string;
  sourceUrl?: string;
  mode?: "replication" | "template" | "greenfield";
  tier?: "free" | "paid";
  templateKey?: string;
}

export interface SiteFile {
  key: string;
  size: number;
  lastModified: string | null;
  url: string;
  type: "html" | "css" | "js" | "image" | "video" | "font" | "favicon" | "other";
}

export interface JobStatus {
  found: boolean;
  queue?: string;
  state?: string;
  progress?: number;
  returnvalue?: unknown;
  failedReason?: string;
  data?: unknown;
}

export interface PipelineRunBody {
  url: string;
  pages?: string[];
  mode?: "replication" | "template" | "greenfield";
  tier?: "free" | "paid";
  contentSiteUuid?: string;
  designSiteUuid?: string;
}

export const api = {
  getSites: () => fetchJson<Site[]>("/sites"),
  getSite: (uuid: string) => fetchJson<Site>(`/sites/${encodeURIComponent(uuid)}`),
  createSite: (body: CreateSiteBody) =>
    fetchJson<Site>("/sites", { method: "POST", body: JSON.stringify(body) }),
  scrapeSite: (body: { url: string; name?: string }) =>
    fetchJson<ScrapeSiteResult>("/sites/scrape", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getSiteAiActivity: (siteUuid: string, options?: { actionType?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (options?.actionType) params.set("actionType", options.actionType);
    if (options?.limit != null) params.set("limit", String(options.limit));
    return fetchJson<AiActivityResponse>(
      `/sites/${encodeURIComponent(siteUuid)}/ai-activity?${params.toString()}`,
    );
  },

  getSiteVersions: (siteUuid: string) =>
    fetchJson<SiteVersion[]>(`/sites/${encodeURIComponent(siteUuid)}/versions`),
  publishSiteVersion: (siteUuid: string, version: number) =>
    fetchJson<{ version: number; deployPrefix: string }>(
      `/sites/${encodeURIComponent(siteUuid)}/versions/${version}/publish`,
      { method: "POST" },
    ),
  getPipelineStatus: (siteUuid: string) =>
    fetchJson<PipelineStatus>(`/sites/${encodeURIComponent(siteUuid)}/pipeline/status`),
  getPipelineArtifact: (siteUuid: string, stage: string) =>
    fetchJson<PipelineArtifact>(
      `/sites/${encodeURIComponent(siteUuid)}/pipeline/artifacts/${encodeURIComponent(stage)}`,
    ),
  getPipelineOptions: (siteUuid: string) =>
    fetchJson<PipelineOptions>(`/sites/${encodeURIComponent(siteUuid)}/pipeline/options`),
  getGlobalPipelineOptions: () => fetchJson<PipelineOptions>("/pipeline/options"),
  runPipeline: (siteUuid: string, body: PipelineRunBody) =>
    fetchJson<{ jobId: string; queue: string }>(`/sites/${encodeURIComponent(siteUuid)}/pipeline/run`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  runPipelineStage: (siteUuid: string, stage: string, body: PipelineRunBody) =>
    fetchJson<{ jobId: string; stage: string; queue: string }>(
      `/sites/${encodeURIComponent(siteUuid)}/pipeline/${encodeURIComponent(stage)}`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  getSiteFiles: (siteUuid: string) =>
    fetchJson<{ files: SiteFile[] }>(`/sites/${encodeURIComponent(siteUuid)}/files`),
  getJobStatus: (jobId: string, queue?: string) =>
    fetchJson<JobStatus>(
      `/jobs/${encodeURIComponent(jobId)}/status${queue ? `?queue=${encodeURIComponent(queue)}` : ""}`,
    ),

  getDocs: () => fetchJson<Doc[]>("/docs"),
  getSiteDocs: (siteUuid: string) =>
    fetchJson<Doc[]>(`/sites/${encodeURIComponent(siteUuid)}/docs`),
  getDoc: (key: string) => fetchJson<Doc>(`/docs/${encodeURIComponent(key)}`),
  saveDoc: (key: string, body: { title: string; content: string }) =>
    fetchJson<Doc>(`/docs/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  createDoc: (body: { title: string; content?: string; key?: string }) =>
    fetchJson<Doc>("/docs", { method: "POST", body: JSON.stringify(body) }),
  deleteDoc: (key: string) =>
    fetchWithBase(`/docs/${encodeURIComponent(key)}`, { method: "DELETE" }),
  archiveDoc: (key: string) =>
    fetchJson<Doc>(`/docs/${encodeURIComponent(key)}/archive`, {
      method: "POST",
    }),
  restoreDoc: (key: string) =>
    fetchJson<Doc>(`/docs/${encodeURIComponent(key)}/restore`, {
      method: "POST",
    }),

  getAssets: (params?: { tag?: string; source?: Asset["source"]; analyzed?: boolean }) => {
    const query = new URLSearchParams();
    if (params?.tag) query.set("tag", params.tag);
    if (params?.source) query.set("source", params.source);
    if (params?.analyzed != null) query.set("analyzed", params.analyzed ? "true" : "false");
    return fetchJson<Asset[]>(`/assets${query.toString() ? `?${query.toString()}` : ""}`);
  },
  createAsset: (body: CreateAssetBody) =>
    fetchJson<Asset>("/assets", { method: "POST", body: JSON.stringify(body) }),
  updateAsset: (
    uuid: string,
    body: { name?: string; type?: Asset["type"]; metadata?: AssetMetadata },
  ) =>
    fetchJson<Asset>(`/assets/${uuid}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteAsset: (uuid: string) =>
    fetchWithBase(`/assets/${uuid}`, { method: "DELETE" }),
  regenerateAnalysis: (uuid: string) =>
    fetchJson<{ enqueued: boolean }>(
      `/assets/${encodeURIComponent(uuid)}/regenerate-analysis`,
      { method: "POST" },
    ),
  backfillAnalysis: () =>
    fetchJson<{ enqueued: number }>("/assets/backfill-analysis", {
      method: "POST",
    }),
  getUploadUrl: (filename: string, contentType?: string) =>
    fetchJson<UploadUrl>(
      `/assets/upload-url?filename=${encodeURIComponent(filename)}${contentType ? `&contentType=${encodeURIComponent(contentType)}` : ""}`,
    ),

  getTemplates: (systemOnly?: boolean) =>
    fetchJson<Template[]>(`/templates${systemOnly != null ? `?systemOnly=${systemOnly}` : ""}`),
  getTemplate: (uuid: string) =>
    fetchJson<Template>(`/templates/${encodeURIComponent(uuid)}`),
  createTemplateFromUrl: (body: { url: string; name?: string; category?: string }) =>
    fetchJson<Template>("/templates/from-url", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  createSiteFromTemplate: (templateKey: string, body: { name: string; slug: string }) =>
    fetchJson<Site>("/sites", {
      method: "POST",
      body: JSON.stringify({ ...body, templateKey }),
    }),
  getPlaybooks: () => fetchJson<Playbook[]>("/playbooks"),

  getAiActivity: (limit = 100, siteUuid?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (siteUuid) params.set("siteUuid", siteUuid);
    return fetchJson<AiActivityResponse>(`/ai-activity?${params.toString()}`);
  },

  getOrganizations: () =>
    fetchJson<{ uuid: string; slug: string; name: string }[]>(
      "/organizations",
    ),
  createOrganization: (body: { name: string; slug: string }) =>
    fetchJson<{ uuid: string; slug: string; name: string }>("/organizations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getWorkspaces: () =>
    fetchJson<
      {
        uuid: string;
        slug: string;
        name: string;
        organizationUuid: string | null;
        status: string;
      }[]
    >("/workspaces"),
  createWorkspace: (body: {
    name: string;
    slug: string;
    organizationUuid?: string;
  }) =>
    fetchJson<{ uuid: string; slug: string; name: string }>("/workspaces", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getWorkspace: () =>
    fetchJson<{
      uuid: string;
      slug: string;
      name: string;
      organizationUuid: string | null;
      brandPrimaryColor?: string | null;
      brandFontHeading?: string | null;
      brandFontBody?: string | null;
    }>("/workspaces/me"),
  updateWorkspace: (uuid: string, body: object) =>
    fetchJson<{ uuid: string; name: string }>(`/workspaces/${uuid}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};
