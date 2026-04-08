"use client";

import { useState, useEffect } from "react";
import { getRawUrl } from "@/lib/github-image";
import { useRepo } from "@/contexts/repo-context";
import { useConfig } from "@/contexts/config-context";
import { cn } from "@/lib/utils";
import { Ban, ImageOff, Loader } from "lucide-react";

export function Thumbnail({
  name,
  path,
  url,
  className,
}: {
  name: string;
  path: string | null;
  /**
   * Direct URL to the image, if known. Short-circuits the git lookup.
   * Used when files come from external storage (R2/S3) — the API
   * already returns the public URL.
   */
  url?: string | null;
  className?: string;
}) {
  const [rawUrl, setRawUrl] = useState<string | null>(url || null);
  const [error, setError] = useState<string | null>(null);

  const { owner, repo, isPrivate } = useRepo();
  const { config } = useConfig();
  const branch = config?.branch!;

  useEffect(() => {
    // If the caller provided a URL (external storage), just use it
    if (url) {
      setRawUrl(url);
      setError(null);
      return;
    }

    // Fall back to git lookup for repo-hosted media
    if (!path) {
      setRawUrl(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const resolved = await getRawUrl(owner, repo, branch, name, path, isPrivate);
        if (!cancelled) setRawUrl(resolved);
      } catch (e: any) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.warn(msg);
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, owner, repo, branch, isPrivate, name, url]);

  return (
    <div
      className={cn(
        "bg-muted w-full aspect-square overflow-hidden relative",
        className,
      )}
    >
      {path ? (
        rawUrl ? (
          <img
            src={rawUrl}
            alt={path.split("/").pop() || "thumbnail"}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : error ? (
          <div
            className="flex justify-center items-center absolute inset-0 text-muted-foreground"
            title={error}
          >
            <Ban className="h-4 w-4" />
          </div>
        ) : (
          <div
            className="flex justify-center items-center absolute inset-0 text-muted-foreground"
            title="Loading..."
          >
            <Loader className="h-4 w-4 animate-spin" />
          </div>
        )
      ) : (
        <div
          className="flex justify-center items-center absolute inset-0 text-muted-foreground"
          title="No image"
        >
          <ImageOff className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
