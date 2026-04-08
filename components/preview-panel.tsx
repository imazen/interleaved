"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfig } from "@/contexts/config-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Monitor, Smartphone, Tablet, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PreviewDevice = "phone" | "tablet" | "desktop";

const DEVICE_WIDTHS: Record<PreviewDevice, string> = {
  phone: "375px",
  tablet: "768px",
  desktop: "100%",
};

type PreviewMode = "builtin" | "deploy" | "url";

// Worker URL. Override via NEXT_PUBLIC_PREVIEW_WORKER_URL for staging/dev.
const DEFAULT_WORKER =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_PREVIEW_WORKER_URL) ||
  "https://preview.interleaved.app";

/**
 * Preview panel for the entry editor.
 *
 * Three modes:
 * - builtin: iframes the preview worker at preview.interleaved.app
 * - deploy: iframes a deploy preview URL from Netlify/Vercel/CF Pages
 * - url: iframes a static URL template
 *
 * The worker renders from the latest committed state in git — preview
 * reflects what would be deployed after save. `renderVersion` props can
 * be bumped externally to force a reload after a save.
 */
export function PreviewPanel({
  filePath,
  previewMode = "builtin",
  previewUrl,
  renderVersion = 0,
}: {
  /** Unused now but kept for API compat */
  content?: string;
  filePath?: string;
  format?: "markdown" | "json";
  previewMode?: PreviewMode;
  previewUrl?: string;
  /** Bump this to force a reload (e.g., after save) */
  renderVersion?: number;
}) {
  const { config } = useConfig();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [iframeLoaded, setIframeLoaded] = useState(false);

  // Build the iframe URL
  const iframeSrc = useMemo(() => {
    if (previewMode !== "builtin") {
      return previewUrl || "";
    }
    if (!config) return "";
    const params = new URLSearchParams({
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
    });
    if (filePath) params.set("entry", filePath);
    // cachebust on save version
    if (renderVersion > 0) params.set("v", String(renderVersion));
    return `${DEFAULT_WORKER}/?${params.toString()}`;
  }, [previewMode, previewUrl, config, filePath, renderVersion]);

  // Reload on src change
  useEffect(() => {
    setIframeLoaded(false);
  }, [iframeSrc]);

  const handleRefresh = useCallback(() => {
    if (!iframeRef.current) return;
    setIframeLoaded(false);
    // Force reload by nulling src then restoring
    const src = iframeRef.current.src;
    iframeRef.current.src = "about:blank";
    requestAnimationFrame(() => {
      if (iframeRef.current) iframeRef.current.src = src;
    });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-[300px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 p-2 border-b bg-muted/30">
        <div className="hidden md:flex items-center gap-1">
          <Button
            variant={device === "phone" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setDevice("phone")}
            title="Phone"
          >
            <Smartphone className="size-4" />
          </Button>
          <Button
            variant={device === "tablet" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setDevice("tablet")}
            title="Tablet"
          >
            <Tablet className="size-4" />
          </Button>
          <Button
            variant={device === "desktop" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setDevice("desktop")}
            title="Desktop"
          >
            <Monitor className="size-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          {iframeSrc && (
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              title="Open in new tab"
            >
              <a href={iframeSrc} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleRefresh}
            disabled={!iframeLoaded}
            title="Refresh preview"
          >
            <RefreshCw className={cn("size-4", !iframeLoaded && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 flex justify-center relative">
        {!iframeLoaded && iframeSrc && (
          <Skeleton className="absolute inset-0 w-full h-full" />
        )}
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            title="Preview"
            src={iframeSrc}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            onLoad={() => setIframeLoaded(true)}
            className={cn(
              "bg-white border-0 h-full transition-all",
              device === "desktop" ? "w-full" : "shadow-lg rounded-lg my-4",
            )}
            style={{
              width: DEVICE_WIDTHS[device],
              maxWidth: "100%",
            }}
          />
        ) : (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            No preview URL configured
          </div>
        )}
      </div>
    </div>
  );
}
