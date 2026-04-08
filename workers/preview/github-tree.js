/**
 * Fetch repo contents from GitHub for the preview renderer.
 *
 * Uses the Git Trees API (one recursive call) to get all paths,
 * then fetches only the blobs we need in parallel.
 *
 * Responses are cached by Cloudflare's HTTP edge cache automatically
 * because they're content-addressed by SHA (immutable).
 */

const GH = "https://api.github.com";

function ghHeaders(token) {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "interleaved-preview-worker",
  };
}

/**
 * Resolve a branch name to a commit SHA.
 */
export async function getBranchSha(token, owner, repo, branch) {
  const response = await fetch(
    `${GH}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    { headers: ghHeaders(token) },
  );
  if (!response.ok) {
    throw new Error(`Failed to get branch ${branch}: ${response.status}`);
  }
  const data = await response.json();
  return data.commit.sha;
}

/**
 * Get the full recursive tree of a commit.
 * Returns an array of { path, type: "blob"|"tree", sha } entries.
 */
export async function getTree(token, owner, repo, sha) {
  const response = await fetch(
    `${GH}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    {
      headers: ghHeaders(token),
      cf: { cacheTtl: 300, cacheEverything: true },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to get tree ${sha}: ${response.status}`);
  }
  const data = await response.json();
  return data.tree || [];
}

/**
 * Fetch a blob by SHA. Blobs are immutable by SHA — perfect for edge cache.
 * Returns the decoded UTF-8 content (or empty string on error).
 */
export async function getBlob(token, owner, repo, sha) {
  const response = await fetch(
    `${GH}/repos/${owner}/${repo}/git/blobs/${sha}`,
    {
      headers: ghHeaders(token),
      cf: { cacheTtl: 86400, cacheEverything: true }, // 1 day edge cache — content is immutable
    },
  );
  if (!response.ok) {
    return "";
  }
  const data = await response.json();
  if (data.encoding === "base64") {
    const bin = atob(data.content.replace(/\n/g, ""));
    return new TextDecoder().decode(
      new Uint8Array(Array.from(bin, (c) => c.charCodeAt(0))),
    );
  }
  return data.content || "";
}

/**
 * Fetch multiple blobs in parallel.
 * Returns an object keyed by path (not sha).
 */
export async function fetchBlobs(token, owner, repo, entries) {
  const results = await Promise.all(
    entries.map(async (e) => {
      try {
        const content = await getBlob(token, owner, repo, e.sha);
        return [e.path, content];
      } catch {
        return [e.path, ""];
      }
    }),
  );
  return Object.fromEntries(results);
}

/**
 * Filter tree entries by path prefix and extension.
 */
export function filterByPrefix(tree, prefix, extensionPattern) {
  return tree.filter((e) => {
    if (e.type !== "blob") return false;
    if (prefix && !e.path.startsWith(prefix)) return false;
    if (extensionPattern && !extensionPattern.test(e.path)) return false;
    return true;
  });
}
