"use client";

import { useMemo, useRef, useState } from "react";
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

const WORKER_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_PREVIEW_WORKER_URL) ||
  "https://preview.interleaved.app";

export default function SitePreviewPage() {
  const { config } = useConfig();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [loaded, setLoaded] = useState(false);
  const [bustCounter, setBustCounter] = useState(0);

  const iframeSrc = useMemo(() => {
    if (!config) return "";
    const base = `${WORKER_URL}/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/${encodeURIComponent(config.branch)}/`;
    if (bustCounter > 0) return `${base}?v=${bustCounter}`;
    return base;
  }, [config, bustCounter]);

  const reload = () => {
    setLoaded(false);
    setBustCounter((v) => v + 1);
  };

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
          {iframeSrc && (
            <Button variant="ghost" size="icon-sm" asChild title="Open in new tab">
              <a href={iframeSrc} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={reload}
            disabled={!loaded}
            title="Refresh"
          >
            <RefreshCw className={cn("size-4", !loaded && "animate-spin")} />
          </Button>
        </div>
      </div>
    ),
  });

  return (
    <>
      <DocumentTitle
        title={formatRepoBranchTitle(
          "Preview",
          config?.owner || "",
          config?.repo || "",
          config?.branch,
        )}
      />
      <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-7rem)]">
        <div className="flex-1 overflow-auto bg-gray-50 dark:bg-gray-900 flex justify-center relative">
          {!loaded && iframeSrc && (
            <Skeleton className="absolute inset-0 w-full h-full" />
          )}
          {iframeSrc && (
            <iframe
              ref={iframeRef}
              title="Site preview"
              src={iframeSrc}
              sandbox="allow-same-origin"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
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
