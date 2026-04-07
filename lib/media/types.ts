/**
 * Media storage provider interface.
 *
 * Abstracts where media files are stored (GitHub repo, S3/R2, local disk)
 * so the rest of the app doesn't care. Theme assets may stay in git while
 * user uploads go to external storage.
 */

export type MediaFile = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
  sha?: string;
  url?: string | null;
  contentType?: string;
};

export type UploadResult = {
  path: string;
  name: string;
  sha?: string;
  size?: number;
  url?: string;
  extension?: string;
};

export type PresignedUpload = {
  uploadUrl: string;
  publicUrl: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  expiresAt: number;
};

export interface MediaStorageProvider {
  readonly type: "git" | "s3" | "local";

  /** List files in a directory. */
  listFiles(path: string): Promise<MediaFile[]>;

  /**
   * Upload a file. Content is base64-encoded.
   * Returns the stored file metadata including its public URL.
   */
  uploadFile(
    path: string,
    contentBase64: string,
    options?: {
      contentType?: string;
      sha?: string; // For git provider: existing file SHA for updates
    },
  ): Promise<UploadResult>;

  /**
   * Get a presigned upload URL for direct client-to-storage uploads.
   * Not all providers support this (git doesn't). Returns null if unsupported.
   */
  getPresignedUploadUrl?(
    path: string,
    contentType: string,
  ): Promise<PresignedUpload | null>;

  /**
   * Get the public display URL for a media file.
   * Supports optional RIAPI query-string transforms for image processing.
   */
  getUrl(path: string, transforms?: string): string;

  /** Delete a file. */
  deleteFile(path: string, sha?: string): Promise<void>;
}

/**
 * Storage configuration resolved from environment variables.
 * Secrets never go in .pages.yml — they live in the admin app's env.
 */
export type ExternalStorageConfig = {
  type: "s3";
  bucket: string;
  region: string;
  endpoint?: string; // For R2/MinIO — custom S3-compatible endpoint
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string; // Base URL for public access (CDN or Imageflow server)
};

export type GitStorageConfig = {
  type: "git";
  owner: string;
  repo: string;
  branch: string;
  token: string;
};

export type StorageConfig = ExternalStorageConfig | GitStorageConfig;
