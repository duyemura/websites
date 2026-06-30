import { useEffect, useState } from "react";
import type { ApiConfig, Site, Deployment, AiJob } from "../../lib/api";
import {
  listSites,
  generateSite,
  approvePage,
  listDeployments,
  listAiJobs,
  previewUrl,
} from "../../lib/api";

interface SiteManagerProps {
  config: ApiConfig;
  refreshTrigger: number;
}

export function SiteManager({ config, refreshTrigger }: SiteManagerProps) {
  const [sites, setSites] = useState<Site[]>([]);
  const [deployments, setDeployments] = useState<Record<string, Deployment[]>>({});
  const [jobs, setJobs] = useState<Record<string, AiJob[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<Record<string, { type: string; message: string }>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const siteList = await listSites(config);
      setSites(siteList);

      const deploymentMap: Record<string, Deployment[]> = {};
      const jobMap: Record<string, AiJob[]> = {};
      await Promise.all(
        siteList.map(async (site) => {
          try {
            deploymentMap[site.uuid] = await listDeployments(config, site.uuid);
          } catch {
            deploymentMap[site.uuid] = [];
          }
          try {
            jobMap[site.uuid] = await listAiJobs(config, site.uuid);
          } catch {
            jobMap[site.uuid] = [];
          }
        }),
      );
      setDeployments(deploymentMap);
      setJobs(jobMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sites");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.baseUrl, config.token, config.workspaceSlug, refreshTrigger]);

  async function handleGenerate(siteUuid: string) {
    setActionState((prev) => ({ ...prev, [siteUuid]: { type: "generate", message: "Starting build…" } }));
    try {
      const result = await generateSite(config, siteUuid, { accuracy: "accurate" });
      setActionState((prev) => ({
        ...prev,
        [siteUuid]: { type: "generate", message: `Build started: attempt ${result.attemptId}` },
      }));
    } catch (err) {
      setActionState((prev) => ({
        ...prev,
        [siteUuid]: { type: "error", message: err instanceof Error ? err.message : "Build failed" },
      }));
    }
  }

  async function handleApprove(siteUuid: string, slug: string) {
    setActionState((prev) => ({ ...prev, [siteUuid]: { type: "approve", message: `Approving ${slug}…` } }));
    try {
      const result = await approvePage(config, siteUuid, slug);
      setActionState((prev) => ({
        ...prev,
        [siteUuid]: {
          type: "approve",
          message: `Approved ${result.approved}. Queued ${result.remainingPagesEnqueued.length} page(s).`,
        },
      }));
    } catch (err) {
      setActionState((prev) => ({
        ...prev,
        [siteUuid]: { type: "error", message: err instanceof Error ? err.message : "Approval failed" },
      }));
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Sites</h2>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {sites.length === 0 && !loading && (
        <p className="mt-4 text-sm text-gray-500">No sites yet. Scrape a URL to create one.</p>
      )}

      <div className="mt-4 space-y-4">
        {sites.map((site) => {
          const siteDeployments = deployments[site.uuid] ?? [];
          const siteJobs = jobs[site.uuid] ?? [];
          const latestDeployment = siteDeployments[0];
          const latestJob = siteJobs[0];
          const status = actionState[site.uuid];

          return (
            <div key={site.uuid} className="rounded-md border border-gray-200 p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">
                    {site.name} <span className="text-gray-500">({site.slug})</span>
                  </p>
                  <p className="text-sm text-gray-500">
                    {site.mode ?? "greenfield"} · {site.status}
                    {site.sourceUrl && ` · ${site.sourceUrl}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleGenerate(site.uuid)}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Build
                  </button>
                  <button
                    onClick={() => handleApprove(site.uuid, "index")}
                    className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700"
                  >
                    Approve homepage
                  </button>
                  {latestDeployment?.previewUrl && (
                    <a
                      href={previewUrl(config, site.uuid, latestDeployment.buildId)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
                    >
                      Open preview
                    </a>
                  )}
                </div>
              </div>

              {status && (
                <p className={`mt-3 text-sm ${status.type === "error" ? "text-red-600" : "text-blue-600"}`}>
                  {status.message}
                </p>
              )}

              {latestJob && (
                <div className="mt-3 text-sm text-gray-600">
                  <p>
                    Latest job: {latestJob.type} · {latestJob.status}
                  </p>
                </div>
              )}

              {siteDeployments.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium">Deployments</p>
                  <ul className="mt-1 space-y-1 text-sm text-gray-600">
                    {siteDeployments.slice(0, 3).map((d) => (
                      <li key={d.uuid}>
                        {d.buildId} · {d.status}
                        {d.previewUrl && (
                          <span className="ml-2">
                            ·{" "}
                            <a
                              href={d.previewUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              direct link
                            </a>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
