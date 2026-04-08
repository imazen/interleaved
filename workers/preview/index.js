/**
 * Interleaved preview worker.
 *
 * Renders a preview of an Interleaved site (or a single entry) from a
 * GitHub repo. Runs on preview.interleaved.app.
 *
 * URL shape:
 *   GET /?owner=X&repo=Y&branch=Z               → site preview (index)
 *   GET /?owner=X&repo=Y&branch=Z&entry=path    → single entry preview
 *
 * The worker:
 *   1. Authenticates as the Interleaved GitHub App (JWT → installation token)
 *   2. Fetches the branch tree + needed blobs (cached at the edge by SHA)
 *   3. Renders via bundled Handlebars + marked
 *   4. Returns HTML with strict CSP, separate origin, cross-origin isolation
 */

import { getRepoToken } from "./github-auth.js";
import { getBranchSha, getTree, fetchBlobs, filterByPrefix } from "./github-tree.js";
import { WorkerRenderer } from "./renderer.js";

const ALLOWED_PARENTS = [
  "https://interleaved.app",
  "https://www.interleaved.app",
  "https://admin.interleaved.app",
  "https://interleaved-production.up.railway.app",
];

// Strict CSP for preview HTML — the user's content renders with no JS,
// no network access beyond the media CDN, and no form submissions.
const CSP = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://unpkg.com https://cdn.tailwindcss.com",
  "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net data:",
  "img-src 'self' https://media.interleaved.app https://raw.githubusercontent.com data:",
  "script-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' https://interleaved.app https://admin.interleaved.app https://interleaved-production.up.railway.app",
  "base-uri 'none'",
  "connect-src 'none'",
].join("; ");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const owner = url.searchParams.get("owner");
    const repo = url.searchParams.get("repo");
    const branch = url.searchParams.get("branch") || "main";
    const entry = url.searchParams.get("entry");

    if (!owner || !repo) {
      return new Response("owner and repo are required", { status: 400 });
    }

    if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) {
      return new Response("Worker not configured: GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY missing", { status: 500 });
    }

    try {
      // 1. Auth as the GitHub App for this repo
      const token = await getRepoToken(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        owner,
        repo,
      );

      // 2. Resolve branch to SHA (short edge cache — branch HEAD can move)
      const sha = await getBranchSha(token, owner, repo, branch);

      // 3. Fetch the full recursive tree at this SHA
      const tree = await getTree(token, owner, repo, sha);

      // 4. Identify files we need: templates, data, content
      const templateEntries = filterByPrefix(tree, "templates/", /\.html$/i);
      const dataEntries = filterByPrefix(tree, "data/", /\.json$/i);
      const altDataEntries = filterByPrefix(tree, "_data/", /\.json$/i);

      const contentDirs = ["content/posts/", "content/", "posts/", "_posts/", "src/content/blog/"];
      let postEntries = [];
      for (const dir of contentDirs) {
        const found = filterByPrefix(tree, dir, /\.(md|mdx|markdown)$/i);
        if (found.length > 0) {
          postEntries = found;
          break;
        }
      }

      // 5. Fetch all blobs in parallel
      const [templates, data, altData, posts] = await Promise.all([
        fetchBlobs(token, owner, repo, templateEntries),
        fetchBlobs(token, owner, repo, dataEntries),
        fetchBlobs(token, owner, repo, altDataEntries),
        fetchBlobs(token, owner, repo, postEntries),
      ]);

      // 6. If we're rendering a specific entry, fetch that too (if not already loaded)
      let entryContent = "";
      if (entry) {
        const entryTreeItem = tree.find((t) => t.path === entry);
        if (entryTreeItem) {
          const fetched = await fetchBlobs(token, owner, repo, [entryTreeItem]);
          entryContent = fetched[entry] || "";
        }
      }

      // 7. Set up the renderer
      const renderer = new WorkerRenderer();

      for (const [path, source] of Object.entries(templates)) {
        const name = path.replace(/^templates\//, "").replace(/\.html$/, "");
        if (name.startsWith("_")) {
          renderer.registerPartial(name.slice(1), source);
        } else {
          renderer.registerTemplate(name, source);
        }
      }

      const allData = { ...data, ...altData };
      for (const [path, content] of Object.entries(allData)) {
        const name = path.replace(/^_?data\//, "").replace(/\.json$/, "");
        try {
          renderer.registerData(name, JSON.parse(content));
        } catch {
          // Skip invalid JSON
        }
      }

      // 8. Render
      let html;
      if (entry && entryContent) {
        const isJson = entry.endsWith(".json");
        const rendered = isJson
          ? renderer.renderJson(entry, entryContent)
          : renderer.renderMarkdown(entry, entryContent);
        html = rendered.html;
      } else {
        // Site preview — parse all posts for the index
        const parsedPosts = Object.entries(posts).map(([path, content]) => {
          const { frontmatter } = renderer.parseFrontmatter(content);
          return { html: "", frontmatter, path };
        });

        html = renderer.renderCollectionIndex("index", parsedPosts, "posts");

        if (!html) {
          html = `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;color:#666;">
            <h1>No index template</h1>
            <p>Add <code>templates/index.html</code> to your repo to preview the site.</p>
            <p>Found ${parsedPosts.length} posts and ${templateEntries.length} templates.</p>
          </body></html>`;
        }
      }

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": CSP,
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "SAMEORIGIN",
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "private, max-age=0, must-revalidate",
          "X-Preview-SHA": sha.slice(0, 8),
        },
      });
    } catch (error) {
      console.error("Preview render error:", error);
      return new Response(
        `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;color:#c00;">
          <h1>Preview error</h1>
          <pre style="white-space:pre-wrap;word-break:break-word;">${escapeHtml(error.message || String(error))}</pre>
        </body></html>`,
        {
          status: 500,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": CSP,
          },
        },
      );
    }
  },
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
