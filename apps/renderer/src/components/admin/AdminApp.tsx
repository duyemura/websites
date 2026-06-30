import { useEffect, useState } from "react";
import type { ApiConfig, Site } from "../../lib/api";
import { ConfigForm } from "./ConfigForm";
import { ScrapeForm } from "./ScrapeForm";
import { SiteManager } from "./SiteManager";

const STORAGE_KEY = "ploy-admin-config";

function loadConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ApiConfig;
  } catch {
    // ignore
  }
  return {
    baseUrl: "http://localhost:3000",
    token: "",
    workspaceSlug: "",
  };
}

function saveConfig(config: ApiConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function AdminApp() {
  const [config, setConfig] = useState<ApiConfig>(loadConfig);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  function handleSiteCreated(site: Site) {
    setRefreshTrigger((n) => n + 1);
    alert(`Site created: ${site.name} (${site.uuid})`);
  }

  return (
    <div className="space-y-6">
      <ConfigForm config={config} onChange={setConfig} />
      <ScrapeForm config={config} onSiteCreated={handleSiteCreated} />
      <SiteManager config={config} refreshTrigger={refreshTrigger} />
    </div>
  );
}
