/**
 * Auto-detect content collections from a repository that has no .pages.yml.
 *
 * Scans the repo root for directories containing markdown files, samples a
 * few files from each, parses their frontmatter, and builds a synthetic
 * config object equivalent to what .pages.yml would provide.
 */

import { createOctokitInstance } from "@/lib/utils/octokit";
import { parse } from "@/lib/serialization";
import { normalizeConfig } from "@/lib/config";
import { inferFieldsFromSamples, buildInferredCollectionEntry } from "@/lib/infer-fields";

const MAX_DIRS_TO_SCAN = 10;
const MAX_SAMPLES_PER_DIR = 5;

/** Well-known directories that commonly hold content in static site repos. */
const CONTENT_DIR_HINTS = new Set([
  "content", "posts", "blog", "pages", "articles", "docs",
  "src/content", "src/pages", "_posts", "_pages", "_docs",
  "collections",
]);

/** Directories that should be ignored during auto-detection. */
const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".github", ".vscode", ".idea",
  "public", "static", "assets", "dist", "build", "out",
  ".next", ".nuxt", ".astro", ".cache", "vendor",
  "themes", "layouts", "templates", "components",
  "lib", "src/components", "src/lib", "src/utils",
]);

type RepoFile = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
};

/**
 * List the contents of a directory via GitHub API.
 * Returns null if the directory doesn't exist (404).
 */
async function listDirectory(
  octokit: ReturnType<typeof createOctokitInstance>,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<RepoFile[] | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: path || "",
      ref: branch,
    });

    if (!Array.isArray(response.data)) return null;

    return response.data.map((item: any) => ({
      name: item.name,
      path: item.path,
      type: item.type === "dir" ? "dir" : "file",
      size: item.size,
    }));
  } catch (error: any) {
    if (error?.status === 404) return null;
    throw error;
  }
}

/**
 * Fetch the raw content of a file via GitHub API.
 */
async function fetchFileContent(
  octokit: ReturnType<typeof createOctokitInstance>,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (Array.isArray(response.data) || response.data.type !== "file") return null;
    return Buffer.from(response.data.content, "base64").toString();
  } catch {
    return null;
  }
}

function isMarkdown(name: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(name);
}

/**
 * Score a directory by how likely it is to be a content collection.
 * Higher = more likely.
 */
function scoreDirectory(dirPath: string, markdownCount: number, totalCount: number): number {
  let score = 0;

  // Bonus for well-known content directory names
  if (CONTENT_DIR_HINTS.has(dirPath.toLowerCase())) score += 10;
  if (CONTENT_DIR_HINTS.has(dirPath.split("/").pop()?.toLowerCase() ?? "")) score += 5;

  // Penalize directories with very few markdown files relative to total
  const markdownRatio = totalCount > 0 ? markdownCount / totalCount : 0;
  score += markdownRatio * 5;
  score += Math.min(markdownCount, 10); // Up to 10 points for file count

  return score;
}

/**
 * Scan a repository and build a synthetic config by detecting content directories
 * and inferring frontmatter schemas from samples.
 *
 * Returns the normalized config object (same shape as normalizeConfig produces),
 * or null if no content collections could be detected.
 */
export async function inferConfigFromRepo(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<Record<string, unknown> | null> {
  const octokit = createOctokitInstance(token);

  // Step 1: List the repo root
  const rootContents = await listDirectory(octokit, owner, repo, branch, "");
  if (!rootContents) return null;

  // Step 2: Find candidate directories
  const candidates: { path: string; mdFiles: RepoFile[]; totalFiles: number; score: number }[] = [];

  // Check root-level directories
  const rootDirs = rootContents.filter(
    (f) => f.type === "dir" && !IGNORE_DIRS.has(f.name.toLowerCase()) && !f.name.startsWith("."),
  );

  // Also check if root itself has markdown files (flat site)
  const rootMdFiles = rootContents.filter((f) => f.type === "file" && isMarkdown(f.name));

  for (const dir of rootDirs.slice(0, MAX_DIRS_TO_SCAN)) {
    const contents = await listDirectory(octokit, owner, repo, branch, dir.path);
    if (!contents) continue;

    const mdFiles = contents.filter((f) => f.type === "file" && isMarkdown(f.name));
    if (mdFiles.length === 0) {
      // Check one level deeper for nested content (e.g., src/content/blog/)
      const subDirs = contents.filter(
        (f) => f.type === "dir" && !IGNORE_DIRS.has(f.name.toLowerCase()),
      );
      for (const subDir of subDirs.slice(0, 5)) {
        const subContents = await listDirectory(octokit, owner, repo, branch, subDir.path);
        if (!subContents) continue;
        const subMdFiles = subContents.filter((f) => f.type === "file" && isMarkdown(f.name));
        if (subMdFiles.length > 0) {
          const score = scoreDirectory(subDir.path, subMdFiles.length, subContents.length);
          candidates.push({ path: subDir.path, mdFiles: subMdFiles, totalFiles: subContents.length, score });
        }
      }
      continue;
    }

    const score = scoreDirectory(dir.path, mdFiles.length, contents.length);
    candidates.push({ path: dir.path, mdFiles, totalFiles: contents.length, score });
  }

  // If root has markdown files and no better candidates, use root
  if (rootMdFiles.length > 0 && candidates.length === 0) {
    const score = scoreDirectory("", rootMdFiles.length, rootContents.length);
    candidates.push({ path: "", mdFiles: rootMdFiles, totalFiles: rootContents.length, score });
  }

  if (candidates.length === 0) return null;

  // Step 3: Sort by score, take the best
  candidates.sort((a, b) => b.score - a.score);
  const bestCandidates = candidates.slice(0, 5);

  // Step 4: Sample files and infer fields for each collection
  const contentEntries: Record<string, unknown>[] = [];

  for (const candidate of bestCandidates) {
    const samplesToFetch = candidate.mdFiles.slice(0, MAX_SAMPLES_PER_DIR);
    const frontmatterSamples: Record<string, unknown>[] = [];

    for (const file of samplesToFetch) {
      const content = await fetchFileContent(octokit, owner, repo, branch, file.path);
      if (!content) continue;

      try {
        const parsed = parse(content, { format: "yaml-frontmatter" });
        if (parsed && typeof parsed === "object") {
          frontmatterSamples.push(parsed);
        }
      } catch {
        // Skip files with unparseable frontmatter
      }
    }

    const fields = inferFieldsFromSamples(frontmatterSamples);
    const name = candidate.path
      ? candidate.path.replace(/\//g, "-").replace(/^-|-$/g, "")
      : "root";

    contentEntries.push(
      buildInferredCollectionEntry(name, candidate.path || ".", fields),
    );
  }

  if (contentEntries.length === 0) return null;

  // Step 5: Check for common media directories
  const mediaDirs = rootContents.filter(
    (f) => f.type === "dir" && ["images", "media", "img", "uploads", "assets"].includes(f.name.toLowerCase()),
  );

  // Step 6: Build the synthetic config
  const rawConfig: Record<string, unknown> = {
    content: contentEntries,
    _inferred: true,
  };

  if (mediaDirs.length > 0) {
    rawConfig.media = mediaDirs[0].path;
  }

  return normalizeConfig(rawConfig);
}
