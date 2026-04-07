/**
 * Media storage provider factory.
 *
 * Selects the appropriate storage provider based on environment configuration.
 * If MEDIA_S3_BUCKET is set, uses external S3/R2 storage.
 * Otherwise, falls back to git-based storage.
 *
 * Theme/template assets always stay in git regardless of this setting.
 * The external provider is for user-uploaded content media.
 *
 * Environment variables:
 *   MEDIA_S3_BUCKET         — S3 bucket name (presence enables external storage)
 *   MEDIA_S3_REGION         — AWS region or "auto" for R2 (default: "auto")
 *   MEDIA_S3_ENDPOINT       — Custom S3 endpoint for R2/MinIO
 *   MEDIA_S3_ACCESS_KEY_ID  — AWS/R2 access key
 *   MEDIA_S3_SECRET_ACCESS_KEY — AWS/R2 secret key
 *   MEDIA_PUBLIC_URL        — Public base URL for media (CDN or Imageflow server)
 *   MEDIA_BASE_URL          — Alias for MEDIA_PUBLIC_URL (backwards compat)
 */

import type { MediaStorageProvider, GitStorageConfig } from "./types";
import { GitMediaProvider } from "./git-provider";
import { ExternalMediaProvider } from "./external-provider";

/** Check if external storage is configured via environment. */
export function isExternalStorageConfigured(): boolean {
  return Boolean(process.env.MEDIA_S3_BUCKET);
}

/** Get the public base URL for media, if configured. Used by URL generation. */
export function getMediaPublicUrl(): string | null {
  return process.env.MEDIA_PUBLIC_URL || process.env.MEDIA_BASE_URL || null;
}

/**
 * Create the appropriate media storage provider.
 *
 * For external storage, no git config is needed — S3 credentials come from env.
 * For git storage, you must provide the repo context and token.
 */
export function createMediaProvider(
  gitConfig?: GitStorageConfig,
): MediaStorageProvider {
  if (isExternalStorageConfigured()) {
    const bucket = process.env.MEDIA_S3_BUCKET!;
    const region = process.env.MEDIA_S3_REGION || "auto";
    const endpoint = process.env.MEDIA_S3_ENDPOINT;
    const accessKeyId = process.env.MEDIA_S3_ACCESS_KEY_ID || "";
    const secretAccessKey = process.env.MEDIA_S3_SECRET_ACCESS_KEY || "";
    const publicUrl = process.env.MEDIA_PUBLIC_URL || process.env.MEDIA_BASE_URL || "";

    if (!accessKeyId || !secretAccessKey) {
      console.warn(
        "MEDIA_S3_BUCKET is set but MEDIA_S3_ACCESS_KEY_ID or MEDIA_S3_SECRET_ACCESS_KEY is missing. " +
        "Falling back to git storage.",
      );
      if (!gitConfig) throw new Error("Git config required when external storage is misconfigured");
      return new GitMediaProvider(gitConfig);
    }

    if (!publicUrl) {
      console.warn(
        "MEDIA_S3_BUCKET is set but MEDIA_PUBLIC_URL is missing. " +
        "Media URLs will not work correctly.",
      );
    }

    return new ExternalMediaProvider({
      type: "s3",
      bucket,
      region,
      endpoint,
      accessKeyId,
      secretAccessKey,
      publicUrl,
    });
  }

  if (!gitConfig) {
    throw new Error(
      "No media storage configured. Set MEDIA_S3_BUCKET for external storage, " +
      "or provide git config for git-based storage.",
    );
  }

  return new GitMediaProvider(gitConfig);
}

/**
 * Build an RIAPI URL for an image.
 * Works with any media provider — just appends query-string transforms to the base URL.
 *
 * Examples:
 *   riapiUrl("images/hero.jpg", "w=800&format=webp")
 *   riapiUrl("images/hero.jpg", { w: 800, format: "webp" })
 */
export function riapiUrl(
  path: string,
  transforms: string | Record<string, string | number>,
): string {
  const publicUrl = getMediaPublicUrl();
  const base = publicUrl
    ? `${publicUrl.replace(/\/$/, "")}/${encodeURI(path)}`
    : `/${encodeURI(path)}`;

  if (!transforms) return base;

  const qs = typeof transforms === "string"
    ? transforms
    : Object.entries(transforms)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

  return `${base}?${qs}`;
}
