/**
 * Branch-based editing workflow.
 *
 * When workflow=branch, edits go to a draft branch instead of main.
 * Users can preview changes on the draft branch, then publish by
 * creating a PR or merging directly.
 */

import { createOctokitInstance } from "@/lib/utils/octokit";
import type { SiteConfig } from "@/lib/site-config";

/**
 * Get the branch to commit edits to based on workflow config.
 * - workflow=direct → defaultBranch (usually main)
 * - workflow=branch → draftBranch (usually draft)
 */
export function getEditBranch(config: SiteConfig, currentBranch: string): string {
  if (config.workflow === "branch") {
    return config.draftBranch;
  }
  return currentBranch;
}

/**
 * Ensure the draft branch exists. Creates it from the default branch HEAD if needed.
 */
export async function ensureDraftBranch(
  token: string,
  owner: string,
  repo: string,
  config: SiteConfig,
): Promise<string> {
  const octokit = createOctokitInstance(token);
  const draftBranch = config.draftBranch;

  // Check if draft branch exists
  try {
    await octokit.rest.repos.getBranch({
      owner, repo, branch: draftBranch,
    });
    return draftBranch;
  } catch (error: any) {
    if (error.status !== 404) throw error;
  }

  // Create draft branch from default branch HEAD
  const defaultRef = await octokit.rest.git.getRef({
    owner, repo, ref: `heads/${config.defaultBranch}`,
  });

  await octokit.rest.git.createRef({
    owner, repo,
    ref: `refs/heads/${draftBranch}`,
    sha: defaultRef.data.object.sha,
  });

  return draftBranch;
}

/**
 * Create a PR from draft branch to default branch.
 * Returns the PR URL if created, or the existing PR URL if one already exists.
 */
export async function createPublishPr(
  token: string,
  owner: string,
  repo: string,
  config: SiteConfig,
  title?: string,
): Promise<{ url: string; number: number; created: boolean }> {
  const octokit = createOctokitInstance(token);

  // Check for existing open PR from draft → default
  const { data: existingPrs } = await octokit.rest.pulls.list({
    owner, repo,
    head: `${owner}:${config.draftBranch}`,
    base: config.defaultBranch,
    state: "open",
  });

  if (existingPrs.length > 0) {
    return {
      url: existingPrs[0].html_url,
      number: existingPrs[0].number,
      created: false,
    };
  }

  // Create new PR
  const { data: pr } = await octokit.rest.pulls.create({
    owner, repo,
    title: title || "Publish content changes",
    head: config.draftBranch,
    base: config.defaultBranch,
    body: "Content changes from Interleaved.\n\nReview the preview deployment before merging.",
  });

  return {
    url: pr.html_url,
    number: pr.number,
    created: true,
  };
}

/**
 * Merge the draft branch into the default branch (fast publish without PR).
 */
export async function mergeDraftToDefault(
  token: string,
  owner: string,
  repo: string,
  config: SiteConfig,
): Promise<void> {
  const octokit = createOctokitInstance(token);

  await octokit.rest.repos.merge({
    owner, repo,
    base: config.defaultBranch,
    head: config.draftBranch,
    commit_message: "Publish content changes (via Interleaved)",
  });
}

/**
 * Check if there are unpublished changes (draft branch ahead of default).
 */
export async function hasUnpublishedChanges(
  token: string,
  owner: string,
  repo: string,
  config: SiteConfig,
): Promise<{ ahead: number; behind: number }> {
  const octokit = createOctokitInstance(token);

  try {
    const { data } = await octokit.rest.repos.compareCommits({
      owner, repo,
      base: config.defaultBranch,
      head: config.draftBranch,
    });

    return {
      ahead: data.ahead_by,
      behind: data.behind_by,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}
