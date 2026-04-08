"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  EllipsisVertical,
  Loader,
  Mail,
} from "lucide-react";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    {...props}
  >
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

type IdentitiesProps = {
  email: string;
  githubConnected: boolean;
  githubUsername?: string | null;
  githubManageUrl?: string | null;
};

export function Identities({
  email,
  githubConnected,
  githubUsername,
  githubManageUrl,
}: IdentitiesProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<
    "connect" | "disconnect" | null
  >(null);

  const handleConnectGithub = async () => {
    setPendingAction("connect");
    try {
      const result = await signIn.social({
        provider: "github",
        callbackURL: "/settings",
        errorCallbackURL: "/settings",
      });
      if (result.error?.message) toast.error(result.error.message);
    } finally {
      setPendingAction(null);
    }
  };

  const handleDisconnectGithub = async () => {
    setPendingAction("disconnect");
    try {
      const response = await fetch("/api/auth/unlink-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "github" }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.status) {
        const message =
          payload?.message || "Failed to disconnect GitHub account.";
        throw new Error(message);
      }

      toast.success("GitHub account disconnected.");
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to disconnect GitHub account.";
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <ul>
      <li className="flex items-center gap-x-3 border border-b-0 first:rounded-t-md px-3 py-2 text-sm">
        <div className="flex items-center gap-x-2">
          <Mail className="h-4 w-4" />
          <span className="font-medium">Email</span>
        </div>
        <div className="ml-2 truncate text-muted-foreground">{email}</div>
      </li>
      <li className="flex items-center gap-x-3 border first:rounded-t-md last:rounded-b-md px-3 py-2 text-sm">
        <div
          className={cn(
            "flex items-center gap-x-2",
            !githubConnected && "text-muted-foreground",
          )}
        >
          <GithubIcon className="h-4 w-4" />
          <span className="font-medium">GitHub</span>
        </div>
        {githubConnected && (
          <div className="ml-2 truncate text-muted-foreground">
            {githubUsername ? `@${githubUsername}` : "Connected"}
          </div>
        )}
        {!githubConnected ? (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto h-8"
            onClick={handleConnectGithub}
            disabled={pendingAction !== null}
          >
            Connect
            {pendingAction === "connect" && (
              <Loader className="h-4 w-4 animate-spin" />
            )}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-xs"
                variant="outline"
                className="ml-auto"
                disabled={pendingAction !== null}
              >
                {pendingAction === "disconnect" ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <EllipsisVertical className="h-4 w-4" />
                )}
                <span className="sr-only">GitHub actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {githubManageUrl && (
                <>
                  <DropdownMenuItem asChild>
                    <a href={githubManageUrl} target="_blank" rel="noreferrer">
                      Manage on GitHub
                      <ArrowUpRight className="size-3 text-muted-foreground ml-auto" />
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                variant="destructive"
                onClick={handleDisconnectGithub}
                disabled={pendingAction !== null}
              >
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </li>
    </ul>
  );
}
