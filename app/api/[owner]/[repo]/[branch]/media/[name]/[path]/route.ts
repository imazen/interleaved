import { getRepoReadContext } from "@/lib/api-repo-context";
import { getFileExtension, normalizePath } from "@/lib/utils/file";
import { getMediaCache } from "@/lib/github-cache-file";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { isExternalStorageConfigured, createMediaProvider } from "@/lib/media/provider";
import { getRepoId } from "@/lib/github-repo-id";

/**
 * Get the list of media files in a directory.
 *
 * GET /api/[owner]/[repo]/[branch]/media/[path]
 * 
 * Requires authentication.
 */

export async function GET(
  request: Request,
  context: { params: Promise<{ owner: string, repo: string, branch: string, name: string, path: string }> }
) {
  try {
    const params = await context.params;
    const { token, config } = await getRepoReadContext(params);
    
    const mediaConfig = config.object.media.find((item: any) => item.name === params.name) || config.object.media[0];

    if (!mediaConfig) {
      if (params.name) throw createHttpError(`No media configuration named "${params.name}" found for ${params.owner}/${params.repo}/${params.branch}.`, 404);
      throw createHttpError(`No media configuration found for ${params.owner}/${params.repo}/${params.branch}.`, 404);
    }

    const normalizedPath = normalizeMediaPath(
      params.path,
      params.owner,
      params.repo,
      params.branch,
    );
    if (!normalizedPath.startsWith(mediaConfig.input)) throw createHttpError(`Invalid path "${params.path}" for media "${params.name}".`, 400);

    const { searchParams } = new URL(request.url);
    const nocache = searchParams.get('nocache');
    // Allow client to override: ?source=git or ?source=external
    const sourceOverride = searchParams.get("source");

    let results: any[] = [];

    // Helper: list from git
    const listFromGit = async () => {
      try {
        return await getMediaCache(params.owner, params.repo, params.branch, normalizedPath, token, !!nocache);
      } catch (error: any) {
        if (error?.status === 404) return [];
        throw error;
      }
    };

    // Helper: list from external (R2/S3)
    const listFromExternal = async () => {
      try {
        const repoId = await getRepoId(token, params.owner, params.repo);
        const provider = createMediaProvider(repoId);
        const files = await provider.listFiles(normalizedPath);
        return files.map((f) => ({
          type: f.type,
          sha: f.sha,
          name: f.name,
          path: f.path,
          size: f.size,
          downloadUrl: f.url,
        }));
      } catch (error: any) {
        if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return [];
        throw error;
      }
    };

    if (sourceOverride === "git") {
      results = await listFromGit();
    } else if (sourceOverride === "external") {
      results = await listFromExternal();
    } else if (isExternalStorageConfigured()) {
      // No explicit source — try both, merge results. This handles repos
      // that have media in git AND in R2 (common during migration).
      const [gitResults, externalResults] = await Promise.all([
        listFromGit(),
        listFromExternal(),
      ]);
      // Merge: external files override git files with the same name
      const merged = new Map<string, any>();
      for (const item of gitResults) merged.set(item.name || item.path, item);
      for (const item of externalResults) merged.set(item.name || item.path, item);
      results = Array.from(merged.values());
    } else {
      results = await listFromGit();
    }

    if (mediaConfig.extensions && mediaConfig.extensions.length > 0) {
      results = results.filter((item) => {
        if (item.type === "dir") return true;
        const extension = getFileExtension(item.name);
        return mediaConfig.extensions.includes(extension);
      });
    }

    results.sort((a: any, b: any) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      } else {
        return a.type === "dir" ? -1 : 1;
      }
    });

    return Response.json({
      status: "success",
      data: results.map((item: any) => {
        return {
          type: item.type,
          sha: item.sha,
          name: item.name,
          path: item.path,
          extension: item.type === "dir" ? undefined : getFileExtension(item.name),
          size: item.size,
          url: item.downloadUrl
        };
      }),
    });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}

const normalizeMediaPath = (
  rawPath: string,
  owner: string,
  repo: string,
  branch: string,
) => {
  const decodedPath = decodeURIComponent(rawPath || "");

  // Handle markdown-link wrappers: [label](target)
  const markdownMatch = decodedPath.match(/^\[.*?\]\((.+)\)$/);
  const markdownLooseMatch = decodedPath.match(/^\[.*?\]\((.+)$/);
  const candidate = (
    markdownMatch?.[1]
    || markdownLooseMatch?.[1]?.replace(/\)$/, "")
    || decodedPath
  ).trim();

  // If caller accidentally passes a raw.githubusercontent URL, map it back to repo-relative path.
  let repoRelativePath = candidate;
  if (candidate.startsWith("https://raw.githubusercontent.com/")) {
    try {
      const url = new URL(candidate);
      const pathname = decodeURIComponent(url.pathname || "");
      const branchPrefix = `/${owner}/${repo}/${branch}/`;
      if (pathname.startsWith(branchPrefix)) {
        repoRelativePath = pathname.slice(branchPrefix.length);
      }
    } catch {
      repoRelativePath = candidate;
    }
  }

  repoRelativePath = repoRelativePath.split("#")[0]?.split("?")[0] || repoRelativePath;

  return normalizePath(repoRelativePath);
};
