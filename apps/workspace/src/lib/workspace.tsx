import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

interface Workspace {
  uuid: string;
  slug: string;
  name: string;
  organizationUuid: string | null;
  status: string;
}

interface WorkspaceContextValue {
  currentWorkspaceSlug: string;
  setCurrentWorkspaceSlug: (slug: string) => void;
  workspaces: Workspace[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const STORAGE_KEY = "ploy-gyms:workspace-slug";

export function WorkspaceProvider({
  children,
  fetchWorkspaces,
}: {
  children: ReactNode;
  fetchWorkspaces: () => Promise<Workspace[]>;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentWorkspaceSlug, setSlug] = useState<string>(() => {
    if (typeof window === "undefined") return "local";
    return localStorage.getItem(STORAGE_KEY) || "local";
  });

  const refresh = async () => {
    try {
      const list = await fetchWorkspaces();
      setWorkspaces(list);
      if (list.length > 0 && !list.find((w) => w.slug === currentWorkspaceSlug)) {
        const next = list[0].slug;
        setSlug(next);
        localStorage.setItem(STORAGE_KEY, next);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const setCurrentWorkspaceSlug = (slug: string) => {
    setSlug(slug);
    localStorage.setItem(STORAGE_KEY, slug);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        currentWorkspaceSlug,
        setCurrentWorkspaceSlug,
        workspaces,
        isLoading,
        refresh,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}

let activeWorkspaceSlug = "local";

export function setActiveWorkspaceSlug(slug: string) {
  activeWorkspaceSlug = slug;
}

export function getActiveWorkspaceSlug(): string {
  return activeWorkspaceSlug;
}
