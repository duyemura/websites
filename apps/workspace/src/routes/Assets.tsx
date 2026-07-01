import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Download,
  FileText,
  Globe,
  Hexagon,
  Image,
  LayoutGrid,
  List,
  Megaphone,
  MoreHorizontal,
  Package,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { api, type Asset, type AssetMetadata } from "@/lib/api";
import {
  ASSET_TAGS,
  type AssetTagKey,
  assetMatchesTag,
  canRegenerateAnalysis,
  formatBytes,
  formatDate,
  getAssetAnalysis,
  getAssetDescription,
  getAssetFilename,
  getAssetPreviewUrl,
  getAssetSourceLabel,
  getAssetTags,
  getAnalysisQualityLabel,
  isAssetAnalyzed,
  needsAnalysisReview,
} from "@/lib/assets";

type ViewMode = "grid" | "list";

const PAGE_SIZES = [10, 25, 50];

const TAG_ICONS: Record<
  (typeof ASSET_TAGS)[number]["icon"],
  React.ComponentType<{ className?: string }>
> = {
  upload: Upload,
  sparkles: Sparkles,
  figma: ({ className }: { className?: string }) => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" />
      <path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z" />
      <path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z" />
      <path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" />
      <path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" />
    </svg>
  ),
  globe: Globe,
  camera: Camera,
  megaphone: Megaphone,
  shapes: Shapes,
  hexagon: Hexagon,
  package: Package,
  image: Image,
  type: Type,
};

async function getImageDimensions(
  file: File,
): Promise<{ width: number; height: number } | undefined> {
  if (!file.type.startsWith("image/")) return undefined;
  return new Promise((resolve) => {
    const img = document.createElement("img");
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      console.warn("Could not read image dimensions", file.name);
      resolve(undefined);
    };
    img.src = url;
  });
}

function TagIcon({
  icon,
  className,
}: {
  icon: (typeof ASSET_TAGS)[number]["icon"];
  className?: string;
}) {
  const Icon = TAG_ICONS[icon];
  return <Icon className={className} />;
}

function AssetThumbnail({
  asset,
  className,
}: {
  asset: Asset;
  className?: string;
}) {
  const src = getAssetPreviewUrl(asset);
  if (asset.type === "image") {
    return (
      <img
        src={src}
        alt={asset.name}
        className={className}
        loading="lazy"
      />
    );
  }
  if (asset.type === "video") {
    return (
      <div
        className={className}
        style={{
          backgroundImage: `url('/api/assets/${asset.uuid}/raw')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="flex h-full w-full items-center justify-center bg-black/40">
          <Play className="h-6 w-6 text-white" fill="currentColor" />
        </div>
      </div>
    );
  }
  return (
    <div className={className}>
      <FileText className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

const ASSET_SOURCES: { key: Asset["source"]; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "scraped", label: "Scraped" },
  { key: "ai_generated", label: "AI generated" },
];

const ANALYSIS_STATUSES: { key: "analyzed" | "unanalyzed"; label: string }[] = [
  { key: "analyzed", label: "Analyzed" },
  { key: "unanalyzed", label: "Not analyzed" },
];

export function Assets() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<ViewMode>("list");
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<AssetTagKey | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editTitle, setEditTitle] = useState(false);
  const [editDescription, setEditDescription] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [renameUuid, setRenameUuid] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openMenuUuid, setOpenMenuUuid] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<Asset["source"] | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<"analyzed" | "unanalyzed" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: assets, isLoading } = useQuery({
    queryKey: ["assets", { source: selectedSource, analyzed: selectedStatus }],
    queryFn: () =>
      api.getAssets({
        source: selectedSource ?? undefined,
        analyzed: selectedStatus
          ? selectedStatus === "analyzed"
          : undefined,
      }),
  });

  const createAsset = useMutation({
    mutationFn: api.createAsset,
    onSuccess: () => {
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (error) => {
      console.error("createAsset failed", error);
    },
  });

  const updateAsset = useMutation({
    mutationFn: ({
      uuid,
      body,
    }: {
      uuid: string;
      body: { name?: string; metadata?: AssetMetadata };
    }) => api.updateAsset(uuid, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (error) => {
      console.error("updateAsset failed", error);
    },
  });

  const deleteAsset = useMutation({
    mutationFn: api.deleteAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      if (selectedAsset) {
        setSelectedAsset(null);
      }
    },
    onError: (error) => {
      console.error("deleteAsset failed", error);
    },
  });

  const regenerateAnalysis = useMutation({
    mutationFn: api.regenerateAnalysis,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
    onError: (error) => {
      console.error("regenerateAnalysis failed", error);
    },
  });

  useEffect(() => {
    setPage(1);
  }, [search, selectedTag, selectedSource, selectedStatus, pageSize]);

  useEffect(() => {
    if (!openMenuUuid) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-asset-menu]")) {
        setOpenMenuUuid(null);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openMenuUuid]);

  useEffect(() => {
    if (selectedAsset) {
      setDraftTitle(selectedAsset.name);
      setDraftDescription(getAssetDescription(selectedAsset));
      setEditTitle(false);
      setEditDescription(false);
    }
  }, [selectedAsset]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const { signedUrl, publicUrl, storageKey } = await api.getUploadUrl(
        file.name,
        file.type,
      );

      const uploadResponse = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload to storage failed (${uploadResponse.status}). Please try again.`);
      }

      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("font/")
            ? "font"
            : "document";

      const dimensions = await getImageDimensions(file);
      const metadata: AssetMetadata = {
        filename: file.name,
        tags: ["user-uploaded"],
        size: file.size,
        dimensions,
      };

      await createAsset.mutateAsync({
        name: file.name.replace(/\.[^/.]+$/, ""),
        type,
        mimeType: file.type,
        source: "upload",
        url: publicUrl,
        storageKey,
        metadata,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed. Please try again.";
      console.error("asset upload failed", error);
      setUploadError(message);
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const allTags = useMemo(() => {
    const counts: Record<AssetTagKey, number> = {
      "user-uploaded": 0,
      "ai-generated": 0,
      figma: 0,
      website: 0,
      screenshot: 0,
      "ad-creative": 0,
      graphic: 0,
      logo: 0,
      "product-image": 0,
      photograph: 0,
      font: 0,
    };
    for (const asset of assets ?? []) {
      for (const tag of getAssetTags(asset)) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return ASSET_TAGS.map((tag) => ({ ...tag, count: counts[tag.key] }));
  }, [assets]);

  const filteredAssets = useMemo(() => {
    let list = assets ?? [];
    if (selectedTag) {
      list = list.filter((asset) => assetMatchesTag(asset, selectedTag));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((asset) =>
        asset.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [assets, selectedTag, search]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
  const pagedAssets = filteredAssets.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );

  const handleSaveTitle = () => {
    if (!selectedAsset || !draftTitle.trim()) return;
    updateAsset.mutate({
      uuid: selectedAsset.uuid,
      body: { name: draftTitle.trim() },
    });
    setEditTitle(false);
  };

  const handleSaveDescription = () => {
    if (!selectedAsset) return;
    const nextMetadata: AssetMetadata = {
      ...(selectedAsset.metadata ?? {}),
      description: draftDescription.trim(),
    };
    updateAsset.mutate({
      uuid: selectedAsset.uuid,
      body: { metadata: nextMetadata },
    });
    setEditDescription(false);
  };

  const handleStartRename = (asset: Asset) => {
    setRenameUuid(asset.uuid);
    setRenameValue(asset.name);
  };

  const handleSaveRename = (asset: Asset) => {
    const name = renameValue.trim();
    if (!name) return;
    updateAsset.mutate({ uuid: asset.uuid, body: { name } });
    setRenameUuid(null);
  };

  const handleDelete = (uuid: string) => {
    if (confirm("Delete this asset? This cannot be undone.")) {
      deleteAsset.mutate(uuid);
      setOpenMenuUuid(null);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 border-r bg-card/50 p-4">
        <button
          onClick={() => {
            setSelectedTag(null);
            setSelectedSource(null);
            setSelectedStatus(null);
          }}
          className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            selectedTag === null && selectedSource === null && selectedStatus === null
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          }`}
        >
          <span className="flex items-center gap-2">
            <Image className="h-4 w-4" />
            All Assets
          </span>
          <Badge variant="outline" className="h-5 px-1.5 text-xs">
            {assets?.length ?? 0}
          </Badge>
        </button>
        <Separator className="my-3" />
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
            Status
          </p>
          {ANALYSIS_STATUSES.map((status) => (
            <button
              key={status.key}
              onClick={() =>
                setSelectedStatus((prev) => (prev === status.key ? null : status.key))
              }
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                selectedStatus === status.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <span>{status.label}</span>
            </button>
          ))}
        </div>
        <Separator className="my-3" />
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
            Source
          </p>
          {ASSET_SOURCES.map((source) => (
            <button
              key={source.key}
              onClick={() =>
                setSelectedSource((prev) => (prev === source.key ? null : source.key))
              }
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                selectedSource === source.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <span>{source.label}</span>
            </button>
          ))}
        </div>
        <Separator className="my-3" />
        <div className="space-y-0.5">
          <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">
            Tags
          </p>
          {allTags.map((tag) => (
            <button
              key={tag.key}
              onClick={() =>
                setSelectedTag((prev) => (prev === tag.key ? null : tag.key))
              }
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                selectedTag === tag.key
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              <span className="flex items-center gap-2">
                <TagIcon icon={tag.icon} className="h-4 w-4" />
                {tag.label}
              </span>
              {tag.count > 0 && (
                <Badge variant="outline" className="h-5 px-1.5 text-xs">
                  {tag.count}
                </Badge>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <h1 className="text-2xl font-bold tracking-tight">All Assets</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search assets…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-64 pl-9"
              />
            </div>
            <div className="flex items-center rounded-md border">
              <button
                onClick={() => setView("grid")}
                className={`rounded-l-md p-2 ${
                  view === "grid"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
                title="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setView("list")}
                className={`rounded-r-md p-2 ${
                  view === "list"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
                title="List view"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <Button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              size="sm"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "Uploading…" : "Upload"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </header>

        {uploadError && (
          <div className="border-b border-destructive/50 bg-destructive/5 px-6 py-3">
            <p className="text-sm text-destructive">{uploadError}</p>
          </div>
        )}

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : filteredAssets.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <Image className="mb-3 h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">
                No assets yet. Upload images to use across your sites.
              </p>
            </div>
          ) : view === "list" ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[45%]">Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Analysis</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedAssets.map((asset) => (
                    <TableRow
                      key={asset.uuid}
                      className="cursor-pointer"
                      onClick={() => setSelectedAsset(asset)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <AssetThumbnail
                            asset={asset}
                            className="h-10 w-10 rounded-md border bg-muted object-cover"
                          />
                          {renameUuid === asset.uuid ? (
                            <div className="flex flex-1 items-center gap-2">
                              <Input
                                value={renameValue}
                                onChange={(e) =>
                                  setRenameValue(e.target.value)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.stopPropagation();
                                    handleSaveRename(asset);
                                  }
                                  if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setRenameUuid(null);
                                  }
                                }}
                                className="h-8 flex-1"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSaveRename(asset);
                                }}
                                className="rounded p-1 hover:bg-accent"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenameUuid(null);
                                }}
                                className="rounded p-1 hover:bg-accent"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <span className="font-medium">{asset.name}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {asset.type}
                      </TableCell>
                      <TableCell>
                        <AnalysisStatusBadge asset={asset} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatBytes(getFileSizeFromName(asset))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(asset.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="relative" data-asset-menu>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuUuid(
                                openMenuUuid === asset.uuid ? null : asset.uuid,
                              );
                            }}
                            className="rounded p-1 hover:bg-accent"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {openMenuUuid === asset.uuid && (
                            <div className="absolute right-0 top-8 z-10 w-44 rounded-md border bg-card p-1 shadow-lg">
                              {canRegenerateAnalysis(asset) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuUuid(null);
                                    regenerateAnalysis.mutate(asset.uuid);
                                  }}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                                >
                                  <RefreshCw className="h-4 w-4" />
                                  Regenerate analysis
                                </button>
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuUuid(null);
                                  handleStartRename(asset);
                                }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
                              >
                                <Pencil className="h-4 w-4" />
                                Rename
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(asset.uuid);
                                }}
                                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pagedAssets.map((asset) => (
                <div
                  key={asset.uuid}
                  className="group relative cursor-pointer overflow-hidden rounded-lg border bg-card"
                  onClick={() => setSelectedAsset(asset)}
                >
                  <AssetThumbnail
                    asset={asset}
                    className="aspect-video w-full object-cover"
                  />
                  <div className="flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{asset.name}</p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {asset.type}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <AnalysisStatusBadge asset={asset} size="sm" />
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartRename(asset);
                          }}
                          className="rounded p-1 hover:bg-accent"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(asset.uuid);
                          }}
                          className="rounded p-1 hover:bg-accent"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                  </div>
                </div>
              </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {filteredAssets.length > 0 && (
          <div className="flex items-center justify-between border-t px-6 py-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Showing {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, filteredAssets.length)} of{" "}
                {filteredAssets.length} assets
              </span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="rounded p-1 hover:bg-accent disabled:opacity-50"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded p-1 hover:bg-accent disabled:opacity-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded p-1 hover:bg-accent disabled:opacity-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
                className="rounded p-1 hover:bg-accent disabled:opacity-50"
              >
                <ChevronsRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Detail dialog */}
      {selectedAsset && (
        <Dialog open onOpenChange={(open) => !open && setSelectedAsset(null)}>
          <DialogContent>
            {/* Preview */}
            <div className="flex flex-1 items-center justify-center bg-black/5 p-8">
              {selectedAsset.type === "video" ? (
                <video
                  controls
                  src={getAssetPreviewUrl(selectedAsset)}
                  className="max-h-full max-w-full rounded-md"
                />
              ) : selectedAsset.type === "image" ? (
                <img
                  src={getAssetPreviewUrl(selectedAsset)}
                  alt={selectedAsset.name}
                  className="max-h-full max-w-full rounded-md object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <FileText className="h-16 w-16" />
                  <p className="text-sm">Preview not available</p>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="relative flex w-80 flex-col border-l bg-card p-5">
              <div className="mb-4 flex items-start justify-between">
                <h2 className="text-lg font-semibold">Details</h2>
                <DialogClose onClick={() => setSelectedAsset(null)} />
              </div>

              <div className="space-y-5">
                <DetailField label="Title">
                  {editTitle ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTitle();
                          if (e.key === "Escape") {
                            setDraftTitle(selectedAsset.name);
                            setEditTitle(false);
                          }
                        }}
                        className="h-8 flex-1"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveTitle}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setDraftTitle(selectedAsset.name);
                          setEditTitle(false);
                        }}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        {selectedAsset.name || "No title"}
                      </p>
                      <button
                        onClick={() => setEditTitle(true)}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </DetailField>

                <DetailField label="Description">
                  {editDescription ? (
                    <div className="flex items-start gap-2">
                      <Input
                        value={draftDescription}
                        onChange={(e) => setDraftDescription(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveDescription();
                          if (e.key === "Escape") {
                            setDraftDescription(
                              getAssetDescription(selectedAsset),
                            );
                            setEditDescription(false);
                          }
                        }}
                        className="h-8 flex-1"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveDescription}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setDraftDescription(
                            getAssetDescription(selectedAsset),
                          );
                          setEditDescription(false);
                        }}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between">
                      <p className="text-sm">
                        {getAssetDescription(selectedAsset) || "No description"}
                      </p>
                      <button
                        onClick={() => setEditDescription(true)}
                        className="rounded p-1 hover:bg-accent"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </DetailField>

                <DetailField label="Filename">
                  <p className="break-all text-sm">
                    {getAssetFilename(selectedAsset)}
                  </p>
                </DetailField>

                <DetailField label="Type">
                  <p className="text-sm capitalize">{selectedAsset.type}</p>
                </DetailField>

                <DetailField label="Source">
                  <p className="text-sm">{getAssetSourceLabel(selectedAsset.source)}</p>
                </DetailField>

                <DetailField label="Size">
                  <p className="text-sm">
                    {formatBytes(getFileSizeFromName(selectedAsset))}
                  </p>
                </DetailField>

                <DetailField label="Dimensions">
                  <p className="text-sm">
                    {selectedAsset.metadata?.dimensions
                      ? `${selectedAsset.metadata.dimensions.width} × ${selectedAsset.metadata.dimensions.height}`
                      : "—"}
                  </p>
                </DetailField>

                <DetailField label="Created">
                  <p className="text-sm">{formatDate(selectedAsset.createdAt)}</p>
                </DetailField>

                <DetailField label="Tags">
                  {(() => {
                    const tags = getAssetTags(selectedAsset);
                    return (
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tagKey) => {
                          const tag = ASSET_TAGS.find((t) => t.key === tagKey);
                          if (!tag) return null;
                          return (
                            <Badge key={tagKey} variant="secondary">
                              {tag.label}
                            </Badge>
                          );
                        })}
                        {tags.length === 0 && (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </div>
                    );
                  })()}
                </DetailField>

                <AnalysisDetailPanel asset={selectedAsset} />
              </div>

              {(updateAsset.error || deleteAsset.error || regenerateAnalysis.error) && (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-sm text-destructive">
                    {updateAsset.error?.message ||
                      deleteAsset.error?.message ||
                      regenerateAnalysis.error?.message}
                  </p>
                </div>
              )}
              <div className="mt-auto flex flex-col gap-2 pt-6">
                {canRegenerateAnalysis(selectedAsset) && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => regenerateAnalysis.mutate(selectedAsset.uuid)}
                    disabled={regenerateAnalysis.isPending}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerate analysis
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = getAssetPreviewUrl(selectedAsset);
                    a.download = getAssetFilename(selectedAsset) || selectedAsset.name;
                    a.click();
                  }}
                >
                  <Download className="h-4 w-4" />
                  Download
                </Button>
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => handleDelete(selectedAsset.uuid)}
                  disabled={deleteAsset.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete asset
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AnalysisStatusBadge({
  asset,
  size = "md",
}: {
  asset: Asset;
  size?: "sm" | "md";
}) {
  const analyzed = isAssetAnalyzed(asset);
  const needsReview = needsAnalysisReview(asset);

  let variant: "default" | "secondary" | "destructive" | "outline" = "outline";
  let label = analyzed ? "Analyzed" : "Not analyzed";
  if (needsReview) {
    variant = "destructive";
    label = "Needs review";
  } else if (analyzed) {
    variant = "secondary";
  }

  return (
    <Badge variant={variant} className={size === "sm" ? "text-xs" : undefined}>
      {label}
    </Badge>
  );
}

function AnalysisDetailPanel({ asset }: { asset: Asset }) {
  const analysis = getAssetAnalysis(asset);
  if (!analysis) return null;

  const qualityLabel = getAnalysisQualityLabel(asset);

  return (
    <div className="space-y-5 border-t pt-5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">AI Analysis</h3>
        <AnalysisStatusBadge asset={asset} size="sm" />
      </div>

      <DetailField label="Alt text">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-sm">{analysis.altText || "—"}</p>
          {analysis.altText && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(analysis.altText).catch((error) => {
                  console.error("clipboard write failed", error);
                });
              }}
              className="rounded p-1 hover:bg-accent"
              title="Copy alt text"
            >
              <Copy className="h-4 w-4" />
            </button>
          )}
        </div>
      </DetailField>

      <DetailField label="Context">
        <p className="text-sm capitalize">{analysis.context}</p>
      </DetailField>

      {analysis.marketing.useCases.length > 0 && (
        <DetailField label="Use cases">
          <ul className="list-inside list-disc text-sm">
            {analysis.marketing.useCases.map((useCase) => (
              <li key={useCase}>{useCase}</li>
            ))}
          </ul>
        </DetailField>
      )}

      <DetailField label="Quality">
        <div className="flex items-center gap-2">
          {qualityLabel && <Badge variant="secondary">{qualityLabel}</Badge>}
          <span className="text-sm text-muted-foreground capitalize">
            {analysis.quality.resolution} · {analysis.quality.sharpness}
          </span>
        </div>
        {analysis.quality.issues.length > 0 && (
          <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
            {analysis.quality.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </DetailField>

      <DetailField label="Subject">
        <p className="text-sm">{analysis.marketing.subject || "—"}</p>
      </DetailField>

      <DetailField label="Mood">
        <p className="text-sm">{analysis.marketing.mood || "—"}</p>
      </DetailField>

      {analysis.safety.hasIdentifiablePeople && (
        <DetailField label="Safety">
          <Badge variant="destructive">Contains identifiable people</Badge>
        </DetailField>
      )}
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function getFileSizeFromName(asset: Asset): number {
  return asset.metadata?.size ?? 0;
}
