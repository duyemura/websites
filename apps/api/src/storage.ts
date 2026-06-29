export interface UploadUrl {
  signedUrl: string;
  publicUrl: string;
  storageKey: string;
}

export interface StorageProvider {
  getUploadUrl(
    workspaceUuid: string,
    filename: string,
    contentType?: string,
  ): Promise<UploadUrl>;
  getDownloadUrl(storageKey: string): Promise<string>;
  getObjectStream(storageKey: string): Promise<NodeJS.ReadableStream>;
  deleteObject(storageKey: string): Promise<void>;
}
