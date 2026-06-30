import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Save, Plus, Archive } from "lucide-react";
import { api, type Doc } from "@/lib/api";
import { BlockNoteEditor } from "@/components/BlockNoteEditor";

export function Docs() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const { data: docs, isLoading: isLoadingDocs } = useQuery({
    queryKey: ["docs"],
    queryFn: api.getDocs,
  });

  const { data: sites, isLoading: isLoadingSites } = useQuery({
    queryKey: ["sites"],
    queryFn: api.getSites,
  });

  const siteByUuid = useMemo(() => {
    const map = new Map<string, string>();
    for (const site of sites ?? []) {
      map.set(site.uuid, site.name);
    }
    return map;
  }, [sites]);

  const groupedDocs = useMemo(() => {
    const workspace: Doc[] = [];
    const bySite = new Map<string, Doc[]>();
    for (const doc of docs ?? []) {
      if (!doc.siteUuid) {
        workspace.push(doc);
      } else {
        const list = bySite.get(doc.siteUuid) ?? [];
        list.push(doc);
        bySite.set(doc.siteUuid, list);
      }
    }
    return { workspace, bySite };
  }, [docs]);

  const saveDoc = useMutation({
    mutationFn: ({ key, body }: { key: string; body: { title: string; content: string } }) =>
      api.saveDoc(key, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["docs"] });
    },
  });

  const createDoc = useMutation({
    mutationFn: api.createDoc,
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ["docs"] });
      setIsAdding(false);
      setNewTitle("");
      selectDoc(doc.key, doc.title, doc.content ?? "");
    },
  });

  const archiveDoc = useMutation({
    mutationFn: api.archiveDoc,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["docs"] });
      if (selectedKey) {
        setSelectedKey(null);
        setTitle("");
        setContent("");
      }
    },
  });

  const selectDoc = (key: string, docTitle?: string, docContent?: string) => {
    setSelectedKey(key);
    const existing = docs?.find((d) => d.key === key);
    if (existing) {
      setTitle(existing.title);
      setContent(existing.content ?? "");
      return;
    }
    if (docTitle !== undefined) {
      setTitle(docTitle);
      setContent(docContent ?? "");
      return;
    }
    api.getDoc(key).then((fetched) => {
      setTitle(fetched.title);
      setContent(fetched.content ?? "");
    });
  };

  const handleSave = () => {
    if (!selectedKey) return;
    saveDoc.mutate({ key: selectedKey, body: { title, content } });
  };

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    createDoc.mutate({ title: newTitle.trim() });
  };

  const isLoading = isLoadingDocs || isLoadingSites;

  function renderDocList(docs: Doc[], groupLabel: string) {
    return (
      <div className="space-y-1">
        {docs.map((doc) => (
          <button
            key={doc.key}
            onClick={() => selectDoc(doc.key)}
            className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
              selectedKey === doc.key
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            }`}
          >
            <div className="font-medium">{doc.title}</div>
            <div className="flex items-center gap-2 text-xs opacity-80">
              <Badge
                variant={selectedKey === doc.key ? "secondary" : "outline"}
                className="text-[10px] px-1 py-0"
              >
                {groupLabel}
              </Badge>
              <span>Saved</span>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="w-80 border-r bg-card p-4 overflow-auto flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Docs</h2>
          <Button size="sm" variant="outline" onClick={() => setIsAdding(true)} disabled={isAdding}>
            <Plus className="h-4 w-4" />
            Create doc
          </Button>
        </div>
        {isAdding && (
          <div className="mb-4 space-y-2">
            <Input
              placeholder="Document title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setIsAdding(false);
                  setNewTitle("");
                }
              }}
            />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={handleCreate} disabled={createDoc.isPending}>
                Create doc
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsAdding(false);
                  setNewTitle("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-5">
            {docs?.length === 0 && !isAdding && (
              <p className="text-sm text-muted-foreground">No docs yet.</p>
            )}

            {groupedDocs.workspace.length > 0 && (
              <div>
                <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Workspace
                </h3>
                {renderDocList(groupedDocs.workspace, "Workspace")}
              </div>
            )}

            {Array.from(groupedDocs.bySite.entries()).map(([siteUuid, siteDocs]) => {
              const siteName = siteByUuid.get(siteUuid) ?? "Site";
              return (
                <div key={siteUuid}>
                  <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {siteName}
                  </h3>
                  {renderDocList(siteDocs, "Site")}
                </div>
              );
            })}
          </div>
        )}
      </aside>
      <main className="flex-1 p-8 overflow-hidden">
        {selectedKey ? (
          <div className="max-w-3xl h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <input
                className="text-2xl font-bold bg-transparent border-b border-transparent hover:border-input focus:border-input focus:outline-none"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => archiveDoc.mutate(selectedKey)}
                  disabled={archiveDoc.isPending}
                >
                  <Archive className="h-4 w-4" />
                  Archive doc
                </Button>
                <Button onClick={handleSave} disabled={saveDoc.isPending}>
                  <Save className="h-4 w-4" />
                  {saveDoc.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <BlockNoteEditor content={content} onChange={setContent} />
            </div>
            {(saveDoc.isError || createDoc.isError || archiveDoc.isError) && (
              <p className="mt-2 text-sm text-destructive">
                {saveDoc.error?.message ||
                  createDoc.error?.message ||
                  archiveDoc.error?.message}
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground">Select a doc to edit, or create a new one.</p>
          </div>
        )}
      </main>
    </div>
  );
}
