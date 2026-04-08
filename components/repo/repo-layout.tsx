"use client";

import { useEffect } from "react";
import { RepoSidebar } from "@/components/repo/repo-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { useConfig } from "@/contexts/config-context";
import { useRepo } from "@/contexts/repo-context";
import { trackVisit } from "@/lib/tracker";
import {
  RepoHeaderProvider,
  useRepoHeaderState,
} from "@/components/repo/repo-header-context";
import { MobileNav } from "@/components/mobile-nav";
import { GitBranch } from "lucide-react";

function BranchBanner() {
  const { config } = useConfig();
  const { defaultBranch } = useRepo();

  if (!config?.branch || !defaultBranch) return null;
  if (config.branch === defaultBranch) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-3 md:px-6 py-1.5 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
      <GitBranch className="size-3.5 shrink-0" />
      <span>
        Editing on <strong>{config.branch}</strong>, not{" "}
        <strong>{defaultBranch}</strong>
      </span>
    </div>
  );
}

function RepoHeader() {
  const { header } = useRepoHeaderState();
  const hasHeaderContent =
    header !== null &&
    header !== undefined &&
    header !== false &&
    header !== "";

  if (!hasHeaderContent) return null;

  return (
    <header className="sticky top-0 z-30 flex h-12 md:h-14 shrink-0 items-center border-b bg-background px-3 md:px-6">
      <SidebarTrigger className="mr-2 md:hidden" />
      <div className="min-w-0 flex-1">{header}</div>
    </header>
  );
}

export function RepoLayout({ children }: { children: React.ReactNode }) {
  const { config } = useConfig();
  const { owner, repo } = useRepo();

  useEffect(() => {
    if (config?.owner && config?.repo && config?.branch) {
      trackVisit(owner, repo, config.branch);
    }
  }, [config, owner, repo]);

  return (
    <SidebarProvider>
      <RepoHeaderProvider>
        <RepoSidebar />
        <SidebarInset className="min-h-screen">
          <BranchBanner />
          <RepoHeader />
          <main className="min-w-0 flex-1 p-3 pb-20 md:p-6 md:pb-6">{children}</main>
        </SidebarInset>
        <MobileNav />
      </RepoHeaderProvider>
    </SidebarProvider>
  );
}
