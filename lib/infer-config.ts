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
import { inferFieldsFromSamples, buildInferredCollectionEntry, buildInferredFileEntry } from "@/lib/infer-fields";

const MAX_DIRS_TO_SCAN = 10;
const MAX_SAMPLES_PER_DIR = 5;

/** Well-known directories that commonly hold content in static site repos. */
const CONTENT_DIR_HINTS = new Set([
  "content", "posts", "blog", "pages", "articles", "docs",
  "src/content", "src/pages", "_posts", "_pages", "_docs",
  "collections", "data", "_data", "src/data",
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

function isJson(name: string): boolean {
  return /\.json$/i.test(name);
}

function isContentFile(name: string): boolean {
  return isMarkdown(name) || isJson(name);
}

/** Well-known single data files that should be editable as type: "file". */
const DATA_FILE_HINTS = new Set([
  "site.json", "config.json", "settings.json", "navigation.json",
  "nav.json", "menu.json", "menus.json", "metadata.json", "meta.json",
  "social.json", "links.json", "footer.json", "header.json",
]);

/**
 * Score a directory by how likely it is to be a content collection.
 * Higher = more likely.
 */
function scoreDirectory(dirPath: string, contentFileCount: number, totalCount: number): number {
  let score = 0;

  // Bonus for well-known content directory names
  if (CONTENT_DIR_HINTS.has(dirPath.toLowerCase())) score += 10;
  if (CONTENT_DIR_HINTS.has(dirPath.split("/").pop()?.toLowerCase() ?? "")) score += 5;

  // Penalize directories with very few content files relative to total
  const contentRatio = totalCount > 0 ? contentFileCount / totalCount : 0;
  score += contentRatio * 5;
  score += Math.min(contentFileCount, 10); // Up to 10 points for file count

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

  // Step 2: Find candidate directories (with both markdown and JSON)
  type Candidate = {
    path: string;
    contentFiles: RepoFile[];
    totalFiles: number;
    score: number;
    /** Dominant file type in this directory. */
    format: "markdown" | "json" | "mixed";
  };
  const candidates: Candidate[] = [];

  // Also collect single data files found in root or _data/data directories
  const singleDataFiles: RepoFile[] = [];

  // Check root-level directories
  const rootDirs = rootContents.filter(
    (f) => f.type === "dir" && !IGNORE_DIRS.has(f.name.toLowerCase()) && !f.name.startsWith("."),
  );

  // Root-level content files
  const rootContentFiles = rootContents.filter((f) => f.type === "file" && isContentFile(f.name));

  // Root-level single JSON data files (well-known names)
  const rootDataFiles = rootContents.filter(
    (f) => f.type === "file" && isJson(f.name) && DATA_FILE_HINTS.has(f.name.toLowerCase()),
  );
  singleDataFiles.push(...rootDataFiles);

  for (const dir of rootDirs.slice(0, MAX_DIRS_TO_SCAN)) {
    const contents = await listDirectory(octokit, owner, repo, branch, dir.path);
    if (!contents) continue;

    const mdFiles = contents.filter((f) => f.type === "file" && isMarkdown(f.name));
    const jsonFiles = contents.filter((f) => f.type === "file" && isJson(f.name));
    const contentFiles = [...mdFiles, ...jsonFiles];

    // Check for _data/data directories with individual JSON files (single file entries)
    if (["_data", "data"].includes(dir.name.toLowerCase()) && jsonFiles.length > 0 && mdFiles.length === 0) {
      // Treat each JSON file in _data/ as a single editable data file
      singleDataFiles.push(...jsonFiles);
      continue;
    }

    if (contentFiles.length === 0) {
      // Check one level deeper for nested content (e.g., src/content/blog/)
      const subDirs = contents.filter(
        (f) => f.type === "dir" && !IGNORE_DIRS.has(f.name.toLowerCase()),
      );
      for (const subDir of subDirs.slice(0, 5)) {
        const subContents = await listDirectory(octokit, owner, repo, branch, subDir.path);
        if (!subContents) continue;
        const subMd = subContents.filter((f) => f.type === "file" && isMarkdown(f.name));
        const subJson = subContents.filter((f) => f.type === "file" && isJson(f.name));
        const subContent = [...subMd, ...subJson];
        if (subContent.length > 0) {
          const format = subMd.length > 0 && subJson.length === 0 ? "markdown"
            : subJson.length > 0 && subMd.length === 0 ? "json"
            : "mixed";
          const score = scoreDirectory(subDir.path, subContent.length, subContents.length);
          candidates.push({ path: subDir.path, contentFiles: subContent, totalFiles: subContents.length, score, format });
        }
      }
      continue;
    }

    const format = mdFiles.length > 0 && jsonFiles.length === 0 ? "markdown"
      : jsonFiles.length > 0 && mdFiles.length === 0 ? "json"
      : "mixed";
    const score = scoreDirectory(dir.path, contentFiles.length, contents.length);
    candidates.push({ path: dir.path, contentFiles, totalFiles: contents.length, score, format });
  }

  // If root has content files and no better candidates, use root
  if (rootContentFiles.length > 0 && candidates.length === 0) {
    const mdCount = rootContentFiles.filter((f) => isMarkdown(f.name)).length;
    const jsonCount = rootContentFiles.filter((f) => isJson(f.name)).length;
    const format = mdCount > 0 && jsonCount === 0 ? "markdown"
      : jsonCount > 0 && mdCount === 0 ? "json" : "mixed";
    const score = scoreDirectory("", rootContentFiles.length, rootContents.length);
    candidates.push({ path: "", contentFiles: rootContentFiles, totalFiles: rootContents.length, score, format });
  }

  if (candidates.length === 0 && singleDataFiles.length === 0) return null;

  // Step 3: Sort by score, take the best
  candidates.sort((a, b) => b.score - a.score);
  const bestCandidates = candidates.slice(0, 5);

  // Step 4: Sample files and infer fields for each collection
  const contentEntries: Record<string, unknown>[] = [];

  for (const candidate of bestCandidates) {
    // Separate markdown and JSON files
    const mdFiles = candidate.contentFiles.filter((f) => isMarkdown(f.name));
    const jsonFiles = candidate.contentFiles.filter((f) => isJson(f.name));

    // Process markdown files
    if (mdFiles.length > 0) {
      const samplesToFetch = mdFiles.slice(0, MAX_SAMPLES_PER_DIR);
      const frontmatterSamples: Record<string, unknown>[] = [];

      for (const file of samplesToFetch) {
        const content = await fetchFileContent(octokit, owner, repo, branch, file.path);
        if (!content) continue;
        try {
          const parsed = parse(content, { format: "yaml-frontmatter" });
          if (parsed && typeof parsed === "object") {
            frontmatterSamples.push(parsed);
          }
        } catch { /* skip */ }
      }

      if (frontmatterSamples.length > 0) {
        const fields = inferFieldsFromSamples(frontmatterSamples);
        const name = candidate.path
          ? candidate.path.replace(/\//g, "-").replace(/^-|-$/g, "")
          : "root";
        contentEntries.push(
          buildInferredCollectionEntry(name, candidate.path || ".", fields, "yaml-frontmatter"),
        );
      }
    }

    // Process JSON files as a collection (directory of .json files)
    if (jsonFiles.length > 0) {
      const samplesToFetch = jsonFiles.slice(0, MAX_SAMPLES_PER_DIR);
      const jsonSamples: Record<string, unknown>[] = [];

      for (const file of samplesToFetch) {
        const content = await fetchFileContent(octokit, owner, repo, branch, file.path);
        if (!content) continue;
        try {
          const parsed = JSON.parse(content);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            jsonSamples.push(parsed);
          }
        } catch { /* skip */ }
      }

      if (jsonSamples.length > 0) {
        const fields = inferFieldsFromSamples(jsonSamples);
        const baseName = candidate.path
          ? candidate.path.replace(/\//g, "-").replace(/^-|-$/g, "")
          : "root";
        // Avoid name collision with markdown collection from same directory
        const name = mdFiles.length > 0 ? `${baseName}-json` : baseName;
        contentEntries.push(
          buildInferredCollectionEntry(name, candidate.path || ".", fields, "json"),
        );
      }
    }
  }

  // Step 4b: Process single JSON data files as type: "file" entries
  for (const file of singleDataFiles.slice(0, 10)) {
    const content = await fetchFileContent(octokit, owner, repo, branch, file.path);
    if (!content) continue;

    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const fields = inferFieldsFromSamples([parsed]);
        const name = file.name.replace(/\.json$/i, "").replace(/[^a-zA-Z0-9-_]/g, "-");
        contentEntries.push(
          buildInferredFileEntry(name, file.path, fields, "json"),
        );
      }
    } catch { /* skip */ }
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
