import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { SiteList } from "@/components/admin/SiteList";
import { SiteDetail } from "@/components/admin/SiteDetail";
import { NewSitePanel } from "@/components/admin/panels/NewSitePanel";
import { ChatAssistantPanel } from "@/components/admin/panels/ChatAssistantPanel";
import { cn } from "@/lib/utils";

type MainView = { kind: "site"; siteUuid: string; initialTab?: "run" } | { kind: "new" } | { kind: "empty" };

function App() {
  const [view, setView] = useState<MainView>({ kind: "empty" });
  const [chatOpen, setChatOpen] = useState(false);

  const selectedSiteUuid = view.kind === "site" ? view.siteUuid : null;

  function handleSelect(siteUuid: string) {
    setView({ kind: "site", siteUuid });
    setChatOpen(true);
  }

  function handleNewSite() {
    setView({ kind: "new" });
    setChatOpen(false);
  }

  function handleCreated(siteUuid: string, initialTab?: "run") {
    setView({ kind: "site", siteUuid, initialTab });
    setChatOpen(true);
  }

  return (
    <AdminShell>
      <div className="flex h-[calc(100vh-4rem)]">
        <aside className="relative w-72 border-r bg-muted/30">
          <div className="h-full overflow-y-auto">
            <SiteList
              selectedSiteUuid={selectedSiteUuid}
              onSelect={handleSelect}
              onNewSite={handleNewSite}
              onOpenChat={() => setChatOpen(true)}
            />
          </div>
          <div
            className={cn(
              "absolute inset-y-0 left-0 z-10 w-full transform bg-background transition-transform duration-300 ease-in-out",
              chatOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {selectedSiteUuid ? (
              <ChatAssistantPanel
                siteUuid={selectedSiteUuid}
                onClose={() => setChatOpen(false)}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-4 text-center text-sm text-muted-foreground">
                <p>Select a site to use the assistant.</p>
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  className="mt-2 text-primary hover:underline"
                >
                  Back to sites
                </button>
              </div>
            )}
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto p-6">
          {view.kind === "site" ? (
            <SiteDetail siteUuid={view.siteUuid} initialTab={view.initialTab} />
          ) : view.kind === "new" ? (
            <NewSitePanel onCreated={handleCreated} />
          ) : (
            <div className="text-muted-foreground">Select a site to inspect, or create a new site.</div>
          )}
        </main>
      </div>
    </AdminShell>
  );
}

export default App;
