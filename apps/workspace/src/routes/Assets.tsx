import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Trash2, Pencil, Check, X } from "lucide-react";
import { api, type Asset } from "@/lib/api";

export function Assets() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [editingUuid, setEditingUuid] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const { data: assets, isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: api.getAssets,
  });

  const createAsset = useMutation({
    mutationFn: api.createAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });

  const updateAsset = useMutation({
    mutationFn: ({ uuid, body }: { uuid: string; body: { name: string } }) =>
      api.updateAsset(uuid, body),
    onSuccess: () => {
      setEditingUuid(null);
      setEditName("");
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });

  const deleteAsset = useMutation({
    mutationFn: api.deleteAsset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const { signedUrl, publicUrl, storageKey } = await api.getUploadUrl(
        file.name,
        file.type,
      );

      const response = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "document";

      await createAsset.mutateAsync({
        name: file.name,
        type,
        mimeType: file.type,
        url: publicUrl,
        storageKey,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const startEditing = (asset: Asset) => {
    setEditingUuid(asset.uuid);
    setEditName(asset.name);
  };

  const cancelEditing = () => {
    setEditingUuid(null);
    setEditName("");
  };

  const saveName = (uuid: string) => {
    const name = editName.trim();
    if (!name) return;
    updateAsset.mutate({ uuid, body: { name } });
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Assets</h1>
          <p className="text-muted-foreground">
            Images, logos, and media for your sites.
          </p>
        </div>
        <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Upload className="h-4 w-4" />
          {uploading ? "Uploading..." : "Upload asset"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading...</p>
      ) : assets && assets.length > 0 ? (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset: Asset) => (
            <div key={asset.uuid} className="rounded-lg border bg-card p-4">
              {asset.type === "image" ? (
                <img
                  src={`/api/assets/${asset.uuid}/raw`}
                  alt={asset.name}
                  className="mb-3 aspect-video w-full rounded-md object-cover"
                />
              ) : (
                <div className="mb-3 flex aspect-video items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                  {asset.type}
                </div>
              )}
              <div className="flex items-center gap-2">
                {editingUuid === asset.uuid ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveName(asset.uuid);
                        if (e.key === "Escape") cancelEditing();
                      }}
                      className="h-8 flex-1"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => saveName(asset.uuid)}
                      disabled={updateAsset.isPending}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={cancelEditing}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="flex-1 truncate text-sm font-medium">{asset.name}</p>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => startEditing(asset)}
                      title="Rename asset"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => deleteAsset.mutate(asset.uuid)}
                      disabled={deleteAsset.isPending}
                      title="Delete asset"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{asset.type}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            No assets yet. Upload images to use across your sites.
          </p>
        </div>
      )}
    </div>
  );
}
