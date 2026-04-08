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
import { loadMapping, resolvePreview } from "./preview-mapping.js";

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

      // 4. Discover files across multiple conventions.
      //
      // Supported layouts:
      //   - Standard: templates/, content/posts/, data/
      //   - Flat: index.html at root, content/*.json as data sources
      //   - Hugo: layouts/, content/, data/
      //   - Astro: src/content/, src/layouts/
      //   - 11ty: _layouts/, _includes/, _data/
      const IGNORE_DIR_RE = /^(node_modules|\.git|\.github|public|static|assets|dist|build|out|\.next|\.nuxt|\.astro|_site|\.cache)\//;

      // Templates: .html anywhere that's not in ignored dirs, biased to known template dirs
      const templateEntries = tree.filter((e) => {
        if (e.type !== "blob" || !/\.html?$/i.test(e.path)) return false;
        if (IGNORE_DIR_RE.test(e.path)) return false;
        return true;
      });

      // Data files: .json in data directories OR content/*.json (flat layouts)
      const dataEntries = tree.filter((e) => {
        if (e.type !== "blob" || !/\.json$/i.test(e.path)) return false;
        if (IGNORE_DIR_RE.test(e.path)) return false;
        if (
          e.path.startsWith("data/") ||
          e.path.startsWith("_data/") ||
          e.path.startsWith("src/data/") ||
          // Flat layout: content/*.json (single-page sites that use JSON as sections)
          /^content\/[^/]+\.json$/.test(e.path)
        ) {
          return true;
        }
        return false;
      });

      // Posts: .md/.mdx files anywhere in content/, posts/, _posts/, src/content/
      const postEntries = tree.filter((e) => {
        if (e.type !== "blob" || !/\.(md|mdx|markdown)$/i.test(e.path)) return false;
        if (IGNORE_DIR_RE.test(e.path)) return false;
        return (
          e.path.startsWith("content/") ||
          e.path.startsWith("posts/") ||
          e.path.startsWith("_posts/") ||
          e.path.startsWith("src/content/") ||
          e.path.startsWith("src/pages/")
        );
      });

      const mappingEntry = tree.find((t) => t.path === ".interleaved/mapping.json");
      const mappingEntries = mappingEntry ? [mappingEntry] : [];

      // 5. Fetch all blobs in parallel
      const [templates, data, posts, mappingBlobs] = await Promise.all([
        fetchBlobs(token, owner, repo, templateEntries),
        fetchBlobs(token, owner, repo, dataEntries),
        fetchBlobs(token, owner, repo, postEntries),
        fetchBlobs(token, owner, repo, mappingEntries),
      ]);

      const mapping = loadMapping(mappingBlobs);
      const allBlobs = { ...templates, ...data, ...posts, ...mappingBlobs };

      // 6. Resolve what to actually render based on the requested entry
      let entryContent = "";
      let renderMode = "index";
      let renderContentPath = "";
      let renderUrl = "";

      if (entry) {
        // Fetch the raw entry so resolvePreview can inspect frontmatter
        const entryTreeItem = tree.find((t) => t.path === entry);
        if (entryTreeItem) {
          const fetched = await fetchBlobs(token, owner, repo, [entryTreeItem]);
          entryContent = fetched[entry] || "";
          allBlobs[entry] = entryContent;
        }

        const resolved = resolvePreview(entry, allBlobs, mapping, tree);
        renderMode = resolved.mode;
        if (resolved.mode === "entry") {
          renderContentPath = resolved.contentPath || entry;
          // Fetch the resolved content file if it's different from the entry
          if (renderContentPath !== entry) {
            const resolvedTreeItem = tree.find((t) => t.path === renderContentPath);
            if (resolvedTreeItem) {
              const fetched = await fetchBlobs(token, owner, repo, [resolvedTreeItem]);
              entryContent = fetched[renderContentPath] || "";
            }
          }
        } else if (resolved.mode === "url") {
          renderUrl = resolved.url || "/";
          if (resolved.contentPath) {
            renderContentPath = resolved.contentPath;
            const resolvedTreeItem = tree.find((t) => t.path === renderContentPath);
            if (resolvedTreeItem) {
              const fetched = await fetchBlobs(token, owner, repo, [resolvedTreeItem]);
              entryContent = fetched[renderContentPath] || "";
            }
          }
        }
      }

      // 7. Set up the renderer
      const renderer = new WorkerRenderer();

      // Register templates with names stripped of common path prefixes
      for (const [path, source] of Object.entries(templates)) {
        let name = path
          .replace(/^templates\//, "")
          .replace(/^_layouts\//, "")
          .replace(/^layouts\//, "")
          .replace(/^_includes\//, "")
          .replace(/^src\/layouts\//, "")
          .replace(/\.html?$/i, "");
        // Partials: files prefixed with _
        const basename = name.split("/").pop() || name;
        if (basename.startsWith("_")) {
          const partialName = name.replace(/(^|\/)_/, "$1");
          renderer.registerPartial(partialName, source);
        } else {
          renderer.registerTemplate(name, source);
          // Also register under the original path (with dir) so mapping.json
          // can reference templates by full path
          if (path !== name + ".html") {
            renderer.registerTemplate(path.replace(/\.html?$/i, ""), source);
          }
        }
      }

      // Register data files. Strip common prefixes to get the variable name.
      for (const [path, content] of Object.entries(data)) {
        const name = path
          .replace(/^data\//, "")
          .replace(/^_data\//, "")
          .replace(/^src\/data\//, "")
          .replace(/^content\//, "")  // flat layout: content/hero.json → hero
          .replace(/\.json$/i, "");
        try {
          renderer.registerData(name, JSON.parse(content));
        } catch {
          // Skip invalid JSON
        }
      }

      // 8. Render based on resolved mode
      let html;

      const renderIndex = () => {
        const parsedPosts = Object.entries(posts).map(([path, content]) => {
          const { frontmatter } = renderer.parseFrontmatter(content);
          return { html: "", frontmatter, path };
        });
        return renderer.renderCollectionIndex("index", parsedPosts, "posts");
      };

      if (entry && renderMode === "entry" && entryContent) {
        const targetPath = renderContentPath || entry;
        const isJson = targetPath.endsWith(".json");
        const rendered = isJson
          ? renderer.renderJson(targetPath, entryContent)
          : renderer.renderMarkdown(targetPath, entryContent);
        html = rendered.html;
      } else if (entry && renderMode === "url" && renderUrl) {
        // If a content file backs this URL, render it; otherwise fall back to index
        if (entryContent && renderContentPath) {
          const isJson = renderContentPath.endsWith(".json");
          const rendered = isJson
            ? renderer.renderJson(renderContentPath, entryContent)
            : renderer.renderMarkdown(renderContentPath, entryContent);
          html = rendered.html;
        } else {
          html = renderIndex();
        }
      } else {
        // Site preview or template edit — render the index
        html = renderIndex();
      }

      if (!html) {
        const templateList = templateEntries.map((t) => t.path).slice(0, 10);
        const dataList = dataEntries.map((t) => t.path).slice(0, 10);
        const postList = postEntries.map((t) => t.path).slice(0, 10);
        html = `<!DOCTYPE html><html><head><style>
          body { font-family: system-ui; padding: 2rem; color: #333; max-width: 720px; line-height: 1.6; }
          h1 { color: #666; }
          h3 { margin-top: 1.5rem; }
          code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; }
          ul { background: #fafafa; padding: 1rem 1rem 1rem 2.5rem; border-radius: 6px; margin: 0.5rem 0; }
          li { font-family: monospace; font-size: 13px; }
          .hint { color: #888; font-size: 14px; margin-top: 1rem; }
        </style></head><body>
          <h1>Nothing to render</h1>
          <p>The preview worker fetched your repo tree but couldn't find a template to render.</p>
          <h3>What was found:</h3>
          <p><strong>Templates (${templateEntries.length}):</strong></p>
          ${templateList.length ? `<ul>${templateList.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "<p class=\"hint\">(none)</p>"}
          <p><strong>Data files (${dataEntries.length}):</strong></p>
          ${dataList.length ? `<ul>${dataList.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "<p class=\"hint\">(none)</p>"}
          <p><strong>Markdown content (${postEntries.length}):</strong></p>
          ${postList.length ? `<ul>${postList.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "<p class=\"hint\">(none)</p>"}
          <p class="hint">
            Add <code>index.html</code> or <code>templates/index.html</code>
            that uses your data. The data files' contents become global
            template variables (e.g. <code>content/hero.json</code> → <code>{{hero.title}}</code>).
          </p>
        </body></html>`;
      }

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": CSP,
          "X-Content-Type-Options": "nosniff",
          // No X-Frame-Options — CSP frame-ancestors handles iframe policy.
          // Setting both makes browsers enforce the stricter one (SAMEORIGIN),
          // which blocks legit framing from interleaved.app.
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
