import { createContext, useContext, type ReactNode } from "react";
import { useSiteEvents, type SiteEvent } from "@/hooks/useSiteEvents";

interface SiteEventsContextValue {
  events: SiteEvent[];
  connected: boolean;
  error: Error | null;
  clearEvents: () => void;
}

const SiteEventsContext = createContext<SiteEventsContextValue | null>(null);

export function SiteEventsProvider({
  siteUuid,
  children,
}: {
  siteUuid: string;
  children: ReactNode;
}) {
  const value = useSiteEvents(siteUuid);
  return (
    <SiteEventsContext.Provider value={value}>{children}</SiteEventsContext.Provider>
  );
}

export function useSiteEventsContext(): SiteEventsContextValue {
  const context = useContext(SiteEventsContext);
  if (!context) {
    throw new Error(
      "useSiteEventsContext must be used within a SiteEventsProvider",
    );
  }
  return context;
}

export type { SiteEvent };
