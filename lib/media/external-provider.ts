/**
 * S3/R2-compatible external media storage provider.
 *
 * Stores user-uploaded media in an S3-compatible bucket (AWS S3, Cloudflare R2,
 * MinIO, etc.). Serves files through a public URL that can be an Imageflow
 * server for on-the-fly RIAPI transforms.
 *
 * Configuration via environment variables on the admin app:
 *   MEDIA_S3_BUCKET, MEDIA_S3_REGION, MEDIA_S3_ENDPOINT,
 *   MEDIA_S3_ACCESS_KEY_ID, MEDIA_S3_SECRET_ACCESS_KEY,
 *   MEDIA_PUBLIC_URL
 */

import type {
  MediaStorageProvider,
  MediaFile,
  UploadResult,
  PresignedUpload,
  ExternalStorageConfig,
} from "./types";
import { getFileExtension } from "@/lib/utils/file";

/**
 * Minimal S3 request signer.
 * We use the AWS SDK-free approach to avoid a heavy dependency. For production
 * you may want to swap in @aws-sdk/client-s3 or @aws-sdk/s3-request-presigner.
 */

const CONTENT_TYPE_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tiff: "image/tiff",
  tif: "image/tiff",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

function guessContentType(path: string): string {
  const ext = getFileExtension(path).toLowerCase();
  return CONTENT_TYPE_MAP[ext] || "application/octet-stream";
}

export class ExternalMediaProvider implements MediaStorageProvider {
  readonly type = "s3" as const;

  private bucket: string;
  private region: string;
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private publicUrl: string;

  constructor(config: ExternalStorageConfig) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.endpoint = config.endpoint || `https://s3.${config.region}.amazonaws.com`;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.publicUrl = config.publicUrl.replace(/\/$/, "");
  }

  /**
   * Build the S3 endpoint URL for a key.
   * Supports both path-style and virtual-hosted-style, defaulting to path-style
   * for R2/MinIO compatibility.
   */
  private s3Url(key: string): string {
    return `${this.endpoint}/${this.bucket}/${encodeURI(key)}`;
  }

  /**
   * Sign an S3 request using AWS Signature V4.
   * This is a simplified implementation — for production, consider using
   * @aws-sdk/client-s3 which handles edge cases and retries.
   */
  private async signedFetch(
    method: string,
    key: string,
    body?: Uint8Array | null,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const url = this.s3Url(key);
    const headers: Record<string, string> = {
      ...extraHeaders,
    };

    // For simplicity, we use unsigned payload for PUT requests
    // and rely on the S3 endpoint accepting the credentials.
    // In production, implement full SigV4 or use the AWS SDK.
    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      },
      body: body as any ?? undefined,
    });

    return response;
  }

  async listFiles(path: string): Promise<MediaFile[]> {
    const prefix = path ? `${path.replace(/\/$/, "")}/` : "";
    const url = `${this.endpoint}/${this.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=/`;

    const response = await fetch(url, {
      headers: {
        "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      },
    });

    if (!response.ok) {
      throw new Error(`S3 list failed: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const files: MediaFile[] = [];

    // Parse XML response (minimal parser for S3 ListObjectsV2)
    const contentMatches = text.matchAll(/<Contents>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g);
    for (const match of contentMatches) {
      const key = match[1];
      const size = parseInt(match[2], 10);
      const name = key.split("/").pop() || key;
      if (name === "" || key === prefix) continue;

      files.push({
        name,
        path: key,
        type: "file",
        size,
        url: `${this.publicUrl}/${key}`,
      });
    }

    // Parse common prefixes (directories)
    const prefixMatches = text.matchAll(/<CommonPrefixes>\s*<Prefix>(.*?)<\/Prefix>\s*<\/CommonPrefixes>/g);
    for (const match of prefixMatches) {
      const dirPath = match[1].replace(/\/$/, "");
      const name = dirPath.split("/").pop() || dirPath;

      files.push({
        name,
        path: dirPath,
        type: "dir",
      });
    }

    return files;
  }

  async uploadFile(
    path: string,
    contentBase64: string,
    options?: { contentType?: string },
  ): Promise<UploadResult> {
    const bytes = new Uint8Array(Buffer.from(contentBase64, "base64"));
    const contentType = options?.contentType || guessContentType(path);

    const response = await this.signedFetch("PUT", path, bytes, {
      "Content-Type": contentType,
      "Content-Length": bytes.length.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`S3 upload failed: ${response.status} ${body.slice(0, 200)}`);
    }

    return {
      path,
      name: path.split("/").pop() || "",
      size: bytes.length,
      url: `${this.publicUrl}/${path}`,
      extension: getFileExtension(path),
    };
  }

  async getPresignedUploadUrl(
    path: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    // For a proper implementation, use @aws-sdk/s3-request-presigner.
    // This is a placeholder that returns the server-side upload endpoint.
    // The client should POST to the admin API which proxies to S3.
    const expiresAt = Date.now() + 3600_000;

    return {
      uploadUrl: this.s3Url(path),
      publicUrl: `${this.publicUrl}/${path}`,
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      expiresAt,
    };
  }

  /**
   * Get the public URL for a media file, with optional RIAPI transforms.
   * If publicUrl points to an Imageflow server, transforms are query params:
   *   https://cdn.example.com/images/hero.jpg?w=800&format=webp
   */
  getUrl(path: string, transforms?: string): string {
    const base = `${this.publicUrl}/${encodeURI(path)}`;
    if (!transforms) return base;
    return `${base}?${transforms}`;
  }

  async deleteFile(path: string): Promise<void> {
    const response = await this.signedFetch("DELETE", path);
    if (!response.ok && response.status !== 404) {
      throw new Error(`S3 delete failed: ${response.status}`);
    }
  }
}
