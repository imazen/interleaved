"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { GithubAuthExpired } from "@/components/github-auth-expired";
import { isGithubAuthError } from "@/lib/github-auth";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showStack, setShowStack] = useState(false);

  useEffect(() => {
    console.error(error);

    // Report to Sentry if available
    if (typeof window !== "undefined" && (window as any).__SENTRY__) {
      try {
        const Sentry = (window as any).__SENTRY__;
        if (Sentry.captureException) Sentry.captureException(error);
      } catch { /* ignore */ }
    }

    // Also report to server for logging
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          digest: error.digest,
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
      }).catch(() => { /* fire and forget */ });
    } catch { /* ignore */ }
  }, [error]);

  if (isGithubAuthError(error)) {
    return <GithubAuthExpired />;
  }

  return (
    <Empty className="absolute inset-0 border-0 rounded-none">
      <EmptyHeader>
        <EmptyTitle>Something went wrong</EmptyTitle>
        <EmptyDescription>{error.message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-row justify-center gap-2">
          <Link
            className={buttonVariants({ variant: "default" })}
            href="/?noredirect"
          >
            All projects
          </Link>
          <button
            className={buttonVariants({ variant: "outline" })}
            onClick={reset}
          >
            Try again
          </button>
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-4"
          onClick={() => setShowStack((s) => !s)}
        >
          {showStack ? "Hide" : "Show"} details
        </button>
        {showStack && error.stack && (
          <pre className="mt-2 max-w-full overflow-x-auto rounded bg-muted p-3 text-xs text-left whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
            {error.stack}
          </pre>
        )}
        {error.digest && (
          <p className="text-xs text-muted-foreground mt-2">
            Error ID: {error.digest}
          </p>
        )}
      </EmptyContent>
    </Empty>
  );
}
