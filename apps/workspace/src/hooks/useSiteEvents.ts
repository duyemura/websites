import { useEffect, useState } from "react";
import { getAuthToken } from "@/lib/api";
import { getActiveWorkspaceSlug } from "@/lib/workspace";

export interface SiteEvent {
  type: string;
  workspaceUuid: string;
  siteUuid: string | null;
  jobId: string | null;
  timestamp: string;
  payload?: Record<string, unknown> | null;
}

export interface UseSiteEventsState {
  events: SiteEvent[];
  connected: boolean;
  error: Error | null;
  clearEvents: () => void;
}

const MAX_RETRY_DELAY_MS = 30000;

/**
 * Subscribe to the SSE event stream for a site. Uses fetch + ReadableStream so
 * we can send auth headers (EventSource does not support custom headers).
 * Reconnects automatically on transient failures and aborts cleanly on
 * unmount.
 */
export function useSiteEvents(
  siteUuid: string | null | undefined,
): UseSiteEventsState {
  const [events, setEvents] = useState<SiteEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!siteUuid) return;
    const uuid = siteUuid;

    let mounted = true;
    let controller: AbortController | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    function scheduleReconnect() {
      if (!mounted) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
    }

    async function connect() {
      if (!mounted) return;

      controller?.abort();
      controller = new AbortController();

      try {
        const token = await getAuthToken();
        const response = await fetch(
          `/api/sites/${encodeURIComponent(uuid)}/events`,
          {
            method: "GET",
            headers: {
              ...(token
                ? { Authorization: `Bearer ${token}` }
                : {}),
              "x-workspace-slug": getActiveWorkspaceSlug(),
              Accept: "text/event-stream",
            },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const err = new Error(`${response.status}: ${body || response.statusText}`);
          if (response.status === 401 || response.status === 403 || response.status === 404) {
            if (mounted) {
              setError(err);
              setConnected(false);
            }
            return;
          }
          throw err;
        }

        if (!response.body) {
          throw new Error("SSE response has no body");
        }

        retryDelay = 1000;
        if (mounted) {
          setConnected(true);
          setError(null);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let dataBuffer = "";

        try {
          while (mounted) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!mounted) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith("data:")) {
                dataBuffer +=
                  (dataBuffer ? "\n" : "") + line.slice(5).trimStart();
              } else if (line === "") {
                if (dataBuffer) {
                  try {
                    const event = JSON.parse(dataBuffer) as SiteEvent;
                    if (mounted) {
                      setEvents((prev) => [...prev, event]);
                    }
                  } catch {
                    // Ignore malformed events.
                  }
                  dataBuffer = "";
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (err) {
        if (!mounted) return;
        setConnected(false);
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err);
        }
      } finally {
        controller = null;
      }

      if (mounted) {
        scheduleReconnect();
      }
    }

    void connect();

    return () => {
      mounted = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      controller?.abort();
    };
  }, [siteUuid]);

  return {
    events,
    connected,
    error,
    clearEvents: () => setEvents([]),
  };
}
