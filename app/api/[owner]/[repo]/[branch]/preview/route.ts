import { type NextRequest } from "next/server";
import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { SiteRenderer } from "@/lib/renderer";

/**
 * Render a preview of a content file using the site's templates.
 *
 * POST /api/[owner]/[repo]/[branch]/preview
 *
 * Body:
 *   { path?, content?, format?, mode? }
 *   - mode: "entry" (default) | "site" | "data"
 *     - "entry": render a single content file (markdown or content json)
 *     - "site": render the index page using all collection items
 *     - "data": data file edit — render the index using the new data
 *
 * For data files (e.g. _data/site.json), edits affect every page that
 * uses the data, so we render the index page with the proposed data
 * overlaid on top of the repo's existing data.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const user = sessionResult.user;
    const { token } = await getToken(user, params.owner, params.repo);
    if (!token) throw createHttpError("Token not found", 401);

    const data = await request.json();
    const { path: filePath, content, format, mode } = data as {
      path?: string;
      content?: string;
      format?: "markdown" | "json";
      mode?: "entry" | "site" | "data";
    };

    const renderer = new SiteRenderer();
    const octokit = createOctokitInstance(token);

    // Load templates from the repo (templates/ directory)
    await loadRepoTemplates(octokit, params.owner, params.repo, params.branch, renderer);

    // Load data files from the repo (data/ directory)
    await loadRepoData(octokit, params.owner, params.repo, params.branch, renderer);

    // Determine the preview mode
    const isDataFile = filePath?.match(/^_?data\//) ||
                       filePath?.startsWith("data/") ||
                       filePath?.startsWith("_data/");
    const resolvedMode = mode || (isDataFile && filePath ? "data" : (filePath ? "entry" : "site"));

    let html: string;

    if (resolvedMode === "data" && filePath && content) {
      // For data file edits: register the new data, then render the index
      try {
        const dataName = filePath.replace(/^_?data\//, "").replace(/\.json$/i, "");
        const parsedData = JSON.parse(content);
        renderer.registerData(dataName, parsedData);
      } catch {
        // Fall back to raw json render
      }
      // Render the index with the updated data
      const collectionItems = await loadCollectionItems(octokit, params.owner, params.repo, params.branch);
      html = renderer.renderCollectionIndex("index", collectionItems, "posts") ||
             '<html><body style="font-family:system-ui;padding:2rem;color:#888;">No index template found. Add <code>templates/index.html</code> to preview your site.</body></html>';
    } else if (resolvedMode === "site") {
      // Full site preview — render the index page
      const collectionItems = await loadCollectionItems(octokit, params.owner, params.repo, params.branch);
      html = renderer.renderCollectionIndex("index", collectionItems, "posts") ||
             '<html><body style="font-family:system-ui;padding:2rem;color:#888;">No index template found. Add <code>templates/index.html</code> to preview your site.</body></html>';
    } else {
      // Single entry preview
      if (!content) throw createHttpError("content is required for entry preview", 400);
      const isJson = format === "json" || filePath?.endsWith(".json");
      const rendered = isJson
        ? renderer.renderJson(filePath || "preview.json", content)
        : renderer.renderMarkdown(filePath || "preview.md", content);
      html = rendered.html;
    }

    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "default-src 'self' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; script-src 'unsafe-inline' https:; font-src 'self' data: https:",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}

async function loadRepoTemplates(
  octokit: ReturnType<typeof createOctokitInstance>,
  owner: string,
  repo: string,
  branch: string,
  renderer: SiteRenderer,
) {
  for (const dir of ["templates", "_layouts", "_includes"]) {
    try {
      const response = await octokit.rest.repos.getContent({
        owner, repo, path: dir, ref: branch,
      });
      if (!Array.isArray(response.data)) continue;

      for (const file of response.data) {
        if (file.type !== "file" || !file.name.endsWith(".html")) continue;

        const fileResponse = await octokit.rest.repos.getContent({
          owner, repo, path: file.path, ref: branch,
        });
        if (Array.isArray(fileResponse.data) || fileResponse.data.type !== "file") continue;

        const source = Buffer.from(fileResponse.data.content, "base64").toString();
        const name = file.name.replace(/\.html$/, "");

        if (name.startsWith("_")) {
          renderer.registerPartial(name.slice(1), source);
        } else {
          renderer.registerTemplate(name, source);
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }
}

async function loadRepoData(
  octokit: ReturnType<typeof createOctokitInstance>,
  owner: string,
  repo: string,
  branch: string,
  renderer: SiteRenderer,
) {
  for (const dir of ["data", "_data"]) {
    try {
      const response = await octokit.rest.repos.getContent({
        owner, repo, path: dir, ref: branch,
      });
      if (!Array.isArray(response.data)) continue;

      for (const file of response.data) {
        if (file.type !== "file" || !file.name.endsWith(".json")) continue;

        const fileResponse = await octokit.rest.repos.getContent({
          owner, repo, path: file.path, ref: branch,
        });
        if (Array.isArray(fileResponse.data) || fileResponse.data.type !== "file") continue;

        const content = Buffer.from(fileResponse.data.content, "base64").toString();
        const name = file.name.replace(/\.json$/, "");

        try {
          renderer.registerData(name, JSON.parse(content));
        } catch {
          // Invalid JSON, skip
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }
}

/**
 * Load all markdown files from common content directories and parse them
 * for site/index preview.
 */
async function loadCollectionItems(
  octokit: ReturnType<typeof createOctokitInstance>,
  owner: string,
  repo: string,
  branch: string,
): Promise<any[]> {
  const candidates = ["content/posts", "content", "posts", "_posts", "src/content/blog"];
  for (const dir of candidates) {
    try {
      const response = await octokit.rest.repos.getContent({
        owner, repo, path: dir, ref: branch,
      });
      if (!Array.isArray(response.data)) continue;

      const mdFiles = response.data.filter(
        (f: any) => f.type === "file" && /\.(md|mdx)$/i.test(f.name),
      );
      if (mdFiles.length === 0) continue;

      const items: any[] = [];
      for (const file of mdFiles.slice(0, 20)) {
        try {
          const fileResponse = await octokit.rest.repos.getContent({
            owner, repo, path: file.path, ref: branch,
          });
          if (Array.isArray(fileResponse.data) || fileResponse.data.type !== "file") continue;
          const content = Buffer.from(fileResponse.data.content, "base64").toString();

          const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)/);
          if (!match) continue;

          // Parse frontmatter
          const frontmatter: Record<string, any> = {};
          for (const line of match[1].split("\n")) {
            const m = line.match(/^(\w+):\s*(.+)$/);
            if (m) {
              let value = m[2].trim();
              if ((value.startsWith('"') && value.endsWith('"')) ||
                  (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
              }
              frontmatter[m[1]] = value;
            }
          }

          items.push({
            html: "",
            frontmatter,
            path: file.path,
            outputPath: file.path.replace(/\.(md|mdx)$/i, ".html"),
          });
        } catch {
          // skip bad files
        }
      }

      return items;
    } catch {
      // try next candidate
    }
  }
  return [];
}
