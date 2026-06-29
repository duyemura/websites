import { getActiveWorkspaceSlug } from "./workspace";

const API_BASE = "/api";

let authTokenGetter: (() => Promise<string | null | undefined>) | null = null;

export function setAuthTokenGetter(
  getter: () => Promise<string | null | undefined>,
) {
  authTokenGetter = getter;
}

async function getAuthToken(): Promise<string | null> {
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
  subdomain?: string | null;
  customDomain?: string | null;
  themeUuid?: string | null;
  defaultMetaTitle?: string | null;
  defaultMetaDescription?: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface AssetMetadata {
  filename?: string;
  description?: string;
  tags?: string[];
  size?: number;
  dimensions?: { width: number; height: number };
}

export interface Asset {
  uuid: string;
  workspaceUuid: string;
  name: string;
  type: "image" | "video" | "audio" | "font" | "document" | "logo" | "icon";
  mimeType?: string | null;
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

export const api = {
  getSites: () => fetchJson<Site[]>("/sites"),
  getSite: (uuid: string) => fetchJson<Site>(`/sites/${encodeURIComponent(uuid)}`),
  createSite: (body: { name: string; slug: string; templateKey?: string }) =>
    fetchJson<Site>("/sites", { method: "POST", body: JSON.stringify(body) }),
  scrapeSite: (body: { url: string; name?: string }) =>
    fetchJson<ScrapeSiteResult>("/sites/scrape", {
      method: "POST",
      body: JSON.stringify(body),
    }),

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

  getAssets: () => fetchJson<Asset[]>("/assets"),
  createAsset: (
    body: Omit<Asset, "uuid" | "workspaceUuid" | "createdAt" | "signedUrl">,
  ) =>
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
  getUploadUrl: (filename: string, contentType?: string) =>
    fetchJson<UploadUrl>(
      `/assets/upload-url?filename=${encodeURIComponent(filename)}${contentType ? `&contentType=${encodeURIComponent(contentType)}` : ""}`,
    ),

  getTemplates: () => fetchJson<Template[]>("/templates?systemOnly=true"),
  getPlaybooks: () => fetchJson<Playbook[]>("/playbooks"),

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
