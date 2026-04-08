/**
 * S3/R2-compatible external media storage provider.
 *
 * Stores user-uploaded media in an S3-compatible bucket (AWS S3, Cloudflare R2,
 * MinIO, etc.). Serves files through a public URL that can be an Imageflow
 * server for on-the-fly RIAPI transforms.
 */

import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getFileExtension } from "@/lib/utils/file";
import type {
  MediaStorageProvider,
  MediaFile,
  UploadResult,
  PresignedUpload,
  ExternalStorageConfig,
} from "./types";

const CONTENT_TYPE_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", avif: "image/avif",
  svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  tiff: "image/tiff", tif: "image/tiff", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg",
  wav: "audio/wav", woff: "font/woff", woff2: "font/woff2",
  ttf: "font/ttf", otf: "font/otf", json: "application/json",
  css: "text/css", js: "application/javascript",
};

function guessContentType(path: string): string {
  const ext = getFileExtension(path).toLowerCase();
  return CONTENT_TYPE_MAP[ext] || "application/octet-stream";
}

export class ExternalMediaProvider implements MediaStorageProvider {
  readonly type = "s3" as const;

  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(config: ExternalStorageConfig) {
    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl.replace(/\/$/, "");

    this.client = new S3Client({
      region: config.region || "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // R2 requires this for path-style access
      forcePathStyle: true,
    });
  }

  async listFiles(path: string): Promise<MediaFile[]> {
    const prefix = path ? `${path.replace(/\/$/, "")}/` : "";

    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      Delimiter: "/",
    });

    const response = await this.client.send(command);
    const files: MediaFile[] = [];

    // Files
    if (response.Contents) {
      for (const obj of response.Contents) {
        if (!obj.Key || obj.Key === prefix) continue;
        const name = obj.Key.split("/").pop() || obj.Key;
        files.push({
          name,
          path: obj.Key,
          type: "file",
          size: obj.Size,
          url: `${this.publicUrl}/${obj.Key}`,
        });
      }
    }

    // Directories (common prefixes)
    if (response.CommonPrefixes) {
      for (const cp of response.CommonPrefixes) {
        if (!cp.Prefix) continue;
        const dirPath = cp.Prefix.replace(/\/$/, "");
        const name = dirPath.split("/").pop() || dirPath;
        files.push({
          name,
          path: dirPath,
          type: "dir",
        });
      }
    }

    return files;
  }

  async uploadFile(
    path: string,
    contentBase64: string,
    options?: { contentType?: string },
  ): Promise<UploadResult> {
    const body = Buffer.from(contentBase64, "base64");
    const contentType = options?.contentType || guessContentType(path);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: path,
      Body: body,
      ContentType: contentType,
    });

    await this.client.send(command);

    return {
      path,
      name: path.split("/").pop() || "",
      size: body.length,
      url: `${this.publicUrl}/${path}`,
      extension: getFileExtension(path),
    };
  }

  async getPresignedUploadUrl(
    path: string,
    contentType: string,
  ): Promise<PresignedUpload> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: path,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: 3600,
    });

    return {
      uploadUrl,
      publicUrl: `${this.publicUrl}/${path}`,
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      expiresAt: Date.now() + 3600_000,
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
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: path,
    });
    await this.client.send(command);
  }
}
