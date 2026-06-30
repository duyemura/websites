import { useEffect, useState } from "react";
import type { ApiConfig } from "../../lib/api";

interface ConfigFormProps {
  config: ApiConfig;
  onChange: (config: ApiConfig) => void;
}

export function ConfigForm({ config, onChange }: ConfigFormProps) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl);
  const [token, setToken] = useState(config.token);
  const [workspaceSlug, setWorkspaceSlug] = useState(config.workspaceSlug);

  useEffect(() => {
    onChange({ baseUrl, token, workspaceSlug });
  }, [baseUrl, token, workspaceSlug, onChange]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">API config</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">API base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="http://localhost:3000"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Bearer token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="clerk session token"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Workspace slug</span>
          <input
            type="text"
            value={workspaceSlug}
            onChange={(e) => setWorkspaceSlug(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="my-workspace"
          />
        </label>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        The token is sent as the Authorization header. For local dev with CLERK_VERIFY_TOKENS=false,
        any string works.
      </p>
    </div>
  );
}
