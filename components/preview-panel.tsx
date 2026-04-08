"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/**
 * Preview panel for the entry editor.
 *
 * Supports three modes:
 * - builtin: renders through our Handlebars API (instant)
 * - deploy: shows a deploy preview URL from Netlify/Vercel/CF Pages
 * - url: shows a static URL template
 *
 * Mobile-native: defaults to full width, device switcher on larger screens.
 */
export function PreviewPanel({
  content,
  filePath,
  format,
  previewMode = "builtin",
  previewUrl,
}: {
  content: string;
  filePath?: string;
  format?: "markdown" | "json";
  previewMode?: PreviewMode;
  previewUrl?: string;
}) {
  const { config } = useConfig();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Built-in preview (Handlebars renderer) ---
  const renderBuiltinPreview = useCallback(async () => {
    if (!config || !content) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: filePath,
            content,
            format: format || (filePath?.endsWith(".json") ? "json" : "markdown"),
          }),
        },
      );

      if (!response.ok) {
        setError(`Preview failed: ${response.status}`);
        return;
      }

      const html = await response.text();
      setPreviewHtml(html);
    } catch (e: any) {
      setError(e.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  }, [config, content, filePath, format]);

  // Debounced builtin preview
  useEffect(() => {
    if (previewMode !== "builtin") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(renderBuiltinPreview, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [renderBuiltinPreview, previewMode]);

  // Write HTML to iframe (builtin mode)
  useEffect(() => {
    if (iframeRef.current && previewHtml !== null && previewMode === "builtin") {
      iframeRef.current.srcdoc = previewHtml;
    }
  }, [previewHtml, previewMode]);

  const handleRefresh = () => {
    if (previewMode === "builtin") {
      renderBuiltinPreview();
    } else if (iframeRef.current) {
      // Reload external URL
      const src = iframeRef.current.src;
      iframeRef.current.src = "";
      requestAnimationFrame(() => {
        if (iframeRef.current) iframeRef.current.src = src;
      });
    }
  };

  // Determine iframe src for external modes
  const externalSrc = previewMode !== "builtin" ? previewUrl : undefined;

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
          {externalSrc && (
            <Button
              variant="ghost"
              size="icon-sm"
              asChild
              title="Open in new tab"
            >
              <a href={externalSrc} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh preview"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 overflow-auto bg-gray-50 flex justify-center">
        {error ? (
          <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
            {error}
          </div>
        ) : previewMode === "builtin" && previewHtml === null ? (
          <Skeleton className="w-full h-full" />
        ) : (
          <iframe
            ref={iframeRef}
            title="Preview"
            sandbox={previewMode === "builtin" ? "allow-same-origin" : "allow-same-origin allow-scripts"}
            src={externalSrc}
            className={cn(
              "bg-white border-0 h-full transition-all",
              device === "desktop" ? "w-full" : "shadow-lg rounded-lg my-4",
            )}
            style={{
              width: DEVICE_WIDTHS[device],
              maxWidth: "100%",
            }}
          />
        )}
      </div>
    </div>
  );
}
