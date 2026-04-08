"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/contexts/config-context";
import { DocumentTitle, formatRepoBranchTitle } from "@/components/document-title";
import { useRepoHeader } from "@/components/repo/repo-header-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink, Monitor, RefreshCw, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/lib/utils";

type Device = "phone" | "tablet" | "desktop";
const WIDTHS: Record<Device, string> = {
  phone: "375px",
  tablet: "768px",
  desktop: "100%",
};

export default function SitePreviewPage() {
  const { config } = useConfig();
  const [device, setDevice] = useState<Device>("desktop");
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "site" }),
        },
      );
      if (!response.ok) {
        setError(`Preview failed: HTTP ${response.status}`);
        return;
      }
      setHtml(await response.text());
    } catch (e: any) {
      setError(e.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.branch]);

  useRepoHeader({
    header: (
      <div className="flex items-center justify-between gap-2 w-full">
        <h1 className="font-semibold text-lg truncate">Site preview</h1>
        <div className="flex items-center gap-1">
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
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={reload}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>
    ),
  });

  return (
    <>
      <DocumentTitle title={formatRepoBranchTitle("Preview", config?.owner || "", config?.repo || "", config?.branch)} />
      <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-7rem)]">
        <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 flex justify-center">
          {error ? (
            <div className="flex flex-col items-center justify-center p-8 text-sm text-muted-foreground gap-2">
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={reload}>Retry</Button>
            </div>
          ) : html === null ? (
            <Skeleton className="w-full h-full" />
          ) : (
            <iframe
              title="Site preview"
              srcDoc={html}
              sandbox="allow-same-origin allow-scripts"
              className={cn(
                "bg-white border-0 h-full transition-all",
                device === "desktop" ? "w-full" : "shadow-lg rounded-lg my-4",
              )}
              style={{ width: WIDTHS[device], maxWidth: "100%" }}
            />
          )}
        </div>
      </div>
    </>
  );
}
