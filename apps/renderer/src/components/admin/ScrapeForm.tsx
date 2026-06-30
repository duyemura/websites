import { useState } from "react";
import type { ApiConfig, Site } from "../../lib/api";
import { scrapeSite } from "../../lib/api";

interface ScrapeFormProps {
  config: ApiConfig;
  onSiteCreated: (site: Site) => void;
}

export function ScrapeForm({ config, onSiteCreated }: ScrapeFormProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const result = await scrapeSite(config, url, name || undefined);
      onSiteCreated(result.site);
      setUrl("");
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold">Scrape a site</h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example-gym.com"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          required
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Site name (optional)"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Scraping…" : "Scrape"}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </form>
  );
}
