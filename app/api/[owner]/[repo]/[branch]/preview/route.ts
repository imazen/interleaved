import { type NextRequest } from "next/server";
import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { getConfig } from "@/lib/config-store";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { SiteRenderer } from "@/lib/renderer";

/**
 * Render a preview of a content file using the site's templates.
 *
 * POST /api/[owner]/[repo]/[branch]/preview
 *
 * Body:
 *   { path: string, content: string, format?: "markdown" | "json" }
 *
 * Loads templates and data from the repo, renders the content, returns HTML.
 * Used by the editor preview tab.
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
    const { path: filePath, content, format } = data as {
      path: string;
      content: string;
      format?: "markdown" | "json";
    };

    if (!content) throw createHttpError("content is required", 400);

    const renderer = new SiteRenderer();
    const octokit = createOctokitInstance(token);

    // Load templates from the repo (templates/ directory)
    await loadRepoTemplates(octokit, params.owner, params.repo, params.branch, renderer);

    // Load data files from the repo (data/ directory)
    await loadRepoData(octokit, params.owner, params.repo, params.branch, renderer);

    // Render the content
    const isJson = format === "json" || filePath?.endsWith(".json");
    const rendered = isJson
      ? renderer.renderJson(filePath || "preview.json", content)
      : renderer.renderMarkdown(filePath || "preview.md", content);

    return new Response(rendered.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; script-src 'none'",
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
