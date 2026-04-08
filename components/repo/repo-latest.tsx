"use client";

import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getVisits } from "@/lib/tracker";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, GitBranch } from "lucide-react";

type Visit = { owner: string; repo: string; branch: string; timestamp: number };

type RepoWithBranches = {
  owner: string;
  repo: string;
  visitedBranches: { branch: string; timestamp: number }[];
  allBranches: string[] | null; // null = loading, [] = error/empty
  defaultBranch?: string;
};

export function RepoLatest() {
  const [repos, setRepos] = useState<RepoWithBranches[] | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const visits = getVisits();
    if (visits.length === 0) {
      setRepos([]);
      return;
    }

    // Group visits by repo
    const grouped = new Map<string, RepoWithBranches>();
    for (const v of visits) {
      const key = `${v.owner}/${v.repo}`.toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.visitedBranches.push({ branch: v.branch, timestamp: v.timestamp });
      } else {
        grouped.set(key, {
          owner: v.owner,
          repo: v.repo,
          visitedBranches: [{ branch: v.branch, timestamp: v.timestamp }],
          allBranches: null,
        });
      }
    }

    // Sort repos by most recent visit
    const reposList = Array.from(grouped.values()).sort((a, b) => {
      const aMax = Math.max(...a.visitedBranches.map((v) => v.timestamp));
      const bMax = Math.max(...b.visitedBranches.map((v) => v.timestamp));
      return bMax - aMax;
    }).slice(0, 5);

    // Sort visited branches per repo by recency
    for (const r of reposList) {
      r.visitedBranches.sort((a, b) => b.timestamp - a.timestamp);
    }

    setRepos(reposList);

    // Fetch all branches for each repo in parallel
    reposList.forEach(async (repo, idx) => {
      try {
        const firstBranch = repo.visitedBranches[0].branch;
        const response = await fetch(
          `/api/${repo.owner}/${repo.repo}/${encodeURIComponent(firstBranch)}/branches`,
        );
        if (!response.ok) {
          setRepos((prev) => prev && prev.map((r, i) =>
            i === idx ? { ...r, allBranches: [] } : r
          ));
          return;
        }
        const data = await response.json();
        if (data.status === "success" && Array.isArray(data.data)) {
          const branchNames = data.data
            .map((b: any) => (typeof b === "string" ? b : b.name))
            .sort();
          setRepos((prev) => prev && prev.map((r, i) =>
            i === idx ? { ...r, allBranches: branchNames } : r
          ));
        }
      } catch {
        setRepos((prev) => prev && prev.map((r, i) =>
          i === idx ? { ...r, allBranches: [] } : r
        ));
      }
    });
  }, []);

  if (repos === null) {
    return (
      <ul className="space-y-2">
        {[...Array(2)].map((_, i) => (
          <li key={i} className="border rounded-md p-3">
            <Skeleton className="h-6 w-32 rounded mb-2" />
            <Skeleton className="h-5 w-48 rounded" />
          </li>
        ))}
      </ul>
    );
  }

  if (repos.length === 0) return null;

  return (
    <ul className="space-y-2">
      {repos.map((repo) => {
        const visitedSet = new Set(repo.visitedBranches.map((v) => v.branch));
        // Build display list: visited branches first (with timestamps),
        // then any other branches not visited
        const otherBranches = (repo.allBranches || [])
          .filter((b) => !visitedSet.has(b));

        return (
          <li
            key={`${repo.owner}/${repo.repo}`}
            className="border rounded-md overflow-hidden"
          >
            {/* Repo header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/30 border-b">
              <img
                src={`https://github.com/${repo.owner}.png`}
                alt={repo.owner}
                className="h-6 w-6 rounded"
              />
              <Link
                href={`/${repo.owner}/${repo.repo}/${encodeURIComponent(repo.visitedBranches[0].branch)}`}
                className="font-medium truncate hover:underline"
              >
                {repo.owner}/{repo.repo}
              </Link>
            </div>

            {/* Visited branches */}
            <ul>
              {repo.visitedBranches.map((v) => (
                <li
                  key={v.branch}
                  className="flex items-center gap-2 px-3 py-2 text-sm border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <GitBranch className="size-3.5 text-muted-foreground shrink-0" />
                  <Link
                    href={`/${repo.owner}/${repo.repo}/${encodeURIComponent(v.branch)}`}
                    className="truncate hover:underline flex-1 min-w-0"
                  >
                    {v.branch}
                  </Link>
                  <span className="text-xs text-muted-foreground hidden sm:inline shrink-0">
                    {formatDistanceToNow(new Date(v.timestamp * 1000))} ago
                  </span>
                  <Link
                    className={cn(
                      "shrink-0",
                      buttonVariants({ variant: "outline", size: "xs" }),
                    )}
                    href={`/${repo.owner}/${repo.repo}/${encodeURIComponent(v.branch)}`}
                  >
                    Open
                  </Link>
                </li>
              ))}

              {/* Other branches dropdown */}
              {repo.allBranches === null ? (
                <li className="px-3 py-2 text-xs text-muted-foreground italic">
                  Loading branches...
                </li>
              ) : otherBranches.length > 0 ? (
                <li className="px-3 py-2 border-t">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <GitBranch className="size-3" />
                        {otherBranches.length} other {otherBranches.length === 1 ? "branch" : "branches"}
                        <ChevronDown className="size-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                      {otherBranches.map((branch) => (
                        <DropdownMenuItem key={branch} asChild>
                          <Link href={`/${repo.owner}/${repo.repo}/${encodeURIComponent(branch)}`}>
                            <GitBranch className="size-3 mr-1.5" />
                            <span className="truncate">{branch}</span>
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ) : null}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
