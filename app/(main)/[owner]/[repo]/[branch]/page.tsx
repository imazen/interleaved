"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfig } from "@/contexts/config-context";
import { useUser } from "@/contexts/user-context";
import { hasGithubIdentity } from "@/lib/authz-shared";
import { isConfigEnabled } from "@/lib/config";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Page() {
  const { config } = useConfig();
  const { user } = useUser();
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (config?.object.content?.[0]) {
      router.replace(`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/${config.object.content[0].type}/${config.object.content[0].name}`);
    } else if (config?.object.media) {
      router.replace(`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/media/${config.object.media[0].name}`);
    } else if (hasGithubIdentity(user) && isConfigEnabled(config?.object)) {
      router.replace(`/${config?.owner}/${config?.repo}/${encodeURIComponent(config!.branch)}/configuration`);
    } else {
      setError(true);
    }
  }, [config, router, user]);

  return error
    ? (
      hasGithubIdentity(user)
        ? <Empty className="absolute inset-0 border-0 rounded-none">
            <EmptyHeader>
              <EmptyTitle>No content found</EmptyTitle>
              <EmptyDescription>No markdown files or content collections were detected in this repository. Add markdown files or create a .pages.yml configuration file.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link
                className={buttonVariants({ variant: "default" })}
                href={`https://github.com/${config?.owner}/${config?.repo}/edit/${encodeURIComponent(config!.branch)}/.pages.yml`}
              >
                Add configuration
              </Link>
            </EmptyContent>
          </Empty>
        : <Empty className="absolute inset-0 border-0 rounded-none">
            <EmptyHeader>
              <EmptyTitle>No content found</EmptyTitle>
              <EmptyDescription>No markdown files were detected in this repository. Ask a repository admin to add content or configure the repository.</EmptyDescription>
            </EmptyHeader>
          </Empty>
    )
    : null;
}
