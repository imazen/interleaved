#!/usr/bin/env npx tsx
/**
 * Interleaved MCP Server
 *
 * Exposes the content structure and media library of a GitHub repository
 * to Claude Code via the Model Context Protocol. This lets Claude:
 *
 * - Browse available content collections and their schemas
 * - List media assets in the repository
 * - Get URLs for media with RIAPI query-string transforms
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx npx tsx mcp-server.ts --owner USER --repo REPO [--branch main]
 *
 * Or add to .claude/settings.json:
 *   { "mcpServers": { "interleaved": {
 *       "command": "npx", "args": ["tsx", "path/to/mcp-server.ts"],
 *       "env": { "GITHUB_TOKEN": "ghp_xxx", "REPO_OWNER": "user", "REPO_NAME": "repo" }
 *   }}}
 */

import { Octokit } from "@octokit/rest";

// --- Config from env/args ---

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || getArg("token") || "";
const OWNER = process.env.REPO_OWNER || getArg("owner") || "";
const REPO = process.env.REPO_NAME || getArg("repo") || "";
const BRANCH = process.env.REPO_BRANCH || getArg("branch") || "main";
const MEDIA_BASE_URL = process.env.MEDIA_BASE_URL || ""; // Optional: Imageflow server URL

if (!GITHUB_TOKEN || !OWNER || !REPO) {
  process.stderr.write(
    "Error: GITHUB_TOKEN, REPO_OWNER, and REPO_NAME are required.\n" +
    "Set via environment variables or --token, --owner, --repo flags.\n"
  );
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// --- MCP Protocol (stdio JSON-RPC) ---

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

function respond(id: number | string | null, result: unknown) {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

function respondError(id: number | string | null, code: number, message: string) {
  const msg: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
  const json = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

// --- Tool Implementations ---

async function listCollections(): Promise<unknown> {
  // Try to read .pages.yml first
  try {
    const response = await octokit.rest.repos.getContent({
      owner: OWNER, repo: REPO, path: ".pages.yml", ref: BRANCH,
    });
    if (!Array.isArray(response.data) && response.data.type === "file") {
      const content = Buffer.from(response.data.content, "base64").toString();
      return {
        source: "pages.yml",
        raw: content,
        description: "Content collections defined in .pages.yml. Parse the YAML to see collection names, paths, and field schemas.",
      };
    }
  } catch {
    // No .pages.yml — scan for markdown directories
  }

  // Auto-detect: list root and find markdown-containing directories
  try {
    const root = await octokit.rest.repos.getContent({
      owner: OWNER, repo: REPO, path: "", ref: BRANCH,
    });
    if (!Array.isArray(root.data)) return { collections: [], source: "none" };

    const dirs = root.data.filter(
      (f: any) => f.type === "dir" && !f.name.startsWith(".") &&
        !["node_modules", "public", "static", "dist", "build", ".next"].includes(f.name)
    );

    const collections: { name: string; path: string; markdownFiles: number }[] = [];
    for (const dir of dirs.slice(0, 10)) {
      try {
        const contents = await octokit.rest.repos.getContent({
          owner: OWNER, repo: REPO, path: dir.path, ref: BRANCH,
        });
        if (!Array.isArray(contents.data)) continue;
        const mdFiles = contents.data.filter((f: any) =>
          f.type === "file" && /\.(md|mdx)$/i.test(f.name)
        );
        if (mdFiles.length > 0) {
          collections.push({
            name: dir.name,
            path: dir.path,
            markdownFiles: mdFiles.length,
          });
        }
      } catch { /* skip */ }
    }

    return { source: "auto-detected", collections };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function listMedia(params: Record<string, unknown>): Promise<unknown> {
  const path = typeof params.path === "string" ? params.path : "";
  const searchPath = path || "images";

  try {
    const response = await octokit.rest.repos.getContent({
      owner: OWNER, repo: REPO, path: searchPath, ref: BRANCH,
    });
    if (!Array.isArray(response.data)) {
      return { error: `"${searchPath}" is not a directory` };
    }

    const items = response.data.map((f: any) => ({
      name: f.name,
      path: f.path,
      type: f.type,
      size: f.size,
      url: f.type === "file"
        ? `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${f.path}`
        : undefined,
    }));

    return { path: searchPath, items };
  } catch (e: any) {
    if (e.status === 404) {
      // Try common media directories
      const mediaDirs = ["images", "media", "img", "uploads", "assets", "static/images"];
      const found: string[] = [];
      for (const dir of mediaDirs) {
        try {
          await octokit.rest.repos.getContent({
            owner: OWNER, repo: REPO, path: dir, ref: BRANCH,
          });
          found.push(dir);
        } catch { /* skip */ }
      }
      return {
        error: `Directory "${searchPath}" not found`,
        availableMediaDirs: found.length > 0 ? found : "No common media directories found. Check the repo structure.",
      };
    }
    return { error: e.message };
  }
}

function getMediaUrl(params: Record<string, unknown>): unknown {
  const path = typeof params.path === "string" ? params.path : "";
  if (!path) return { error: "path is required" };

  const transforms = typeof params.transforms === "string" ? params.transforms : "";

  const rawUrl = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;

  const result: Record<string, string> = {
    raw: rawUrl,
    path,
  };

  if (MEDIA_BASE_URL) {
    // Imageflow/RIAPI URL
    const riapiUrl = transforms
      ? `${MEDIA_BASE_URL}/${path}?${transforms}`
      : `${MEDIA_BASE_URL}/${path}`;
    result.riapi = riapiUrl;
    result.example_transforms = "w=800&h=600&mode=crop&format=webp";
  }

  return result;
}

async function getContentSchema(params: Record<string, unknown>): Promise<unknown> {
  const collection = typeof params.collection === "string" ? params.collection : "";
  if (!collection) return { error: "collection name or path is required" };

  // Sample up to 3 markdown files from the collection directory
  try {
    const response = await octokit.rest.repos.getContent({
      owner: OWNER, repo: REPO, path: collection, ref: BRANCH,
    });
    if (!Array.isArray(response.data)) return { error: "Not a directory" };

    const mdFiles = response.data
      .filter((f: any) => f.type === "file" && /\.(md|mdx)$/i.test(f.name))
      .slice(0, 3);

    const samples: { file: string; frontmatter: string }[] = [];
    for (const file of mdFiles) {
      try {
        const fileResponse = await octokit.rest.repos.getContent({
          owner: OWNER, repo: REPO, path: file.path, ref: BRANCH,
        });
        if (Array.isArray(fileResponse.data) || fileResponse.data.type !== "file") continue;
        const content = Buffer.from(fileResponse.data.content, "base64").toString();

        // Extract frontmatter
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (match) {
          samples.push({ file: file.name, frontmatter: match[1] });
        }
      } catch { /* skip */ }
    }

    return {
      collection,
      totalFiles: mdFiles.length,
      samples,
      description: "Frontmatter samples from this collection. Use these to understand the content schema.",
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

// --- MCP Protocol Handling ---

const TOOLS = [
  {
    name: "list_collections",
    description: "List content collections in the repository. Returns collection names, paths, and field schemas (from .pages.yml or auto-detected from markdown directories).",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_media",
    description: "Browse media files in the repository. Returns file names, paths, sizes, and raw GitHub URLs.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path to list (default: 'images'). Try 'media', 'img', 'uploads', 'assets' if not found.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_media_url",
    description: "Get URLs for a media asset. Returns the raw GitHub URL and optionally an Imageflow/RIAPI URL with query-string transforms (resize, crop, format conversion).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path within the repository (e.g., 'images/hero.jpg')",
        },
        transforms: {
          type: "string",
          description: "RIAPI query string for image transforms (e.g., 'w=800&h=600&mode=crop&format=webp'). Only works if MEDIA_BASE_URL is configured.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "get_content_schema",
    description: "Get the frontmatter schema for a content collection by sampling files. Returns raw YAML frontmatter from up to 3 files so you can understand the content structure.",
    inputSchema: {
      type: "object",
      properties: {
        collection: {
          type: "string",
          description: "Collection directory path (e.g., 'posts', 'content/blog')",
        },
      },
      required: ["collection"],
    },
  },
];

async function handleRequest(request: JsonRpcRequest) {
  const { id, method, params } = request;

  switch (method) {
    case "initialize":
      return respond(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "interleaved",
          version: "0.1.0",
        },
      });

    case "initialized":
      // Client acknowledgement, no response needed
      return;

    case "tools/list":
      return respond(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = (params as any)?.name;
      const toolArgs = (params as any)?.arguments || {};

      let result: unknown;
      try {
        switch (toolName) {
          case "list_collections":
            result = await listCollections();
            break;
          case "list_media":
            result = await listMedia(toolArgs);
            break;
          case "get_media_url":
            result = getMediaUrl(toolArgs);
            break;
          case "get_content_schema":
            result = await getContentSchema(toolArgs);
            break;
          default:
            return respondError(id, -32602, `Unknown tool: ${toolName}`);
        }
      } catch (e: any) {
        return respond(id, {
          content: [{ type: "text", text: `Error: ${e.message}` }],
          isError: true,
        });
      }

      return respond(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    }

    default:
      return respondError(id, -32601, `Method not found: ${method}`);
  }
}

// --- stdio transport ---

let buffer = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;

  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;

    const header = buffer.slice(0, headerEnd);
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(lengthMatch[1], 10);
    const bodyStart = headerEnd + 4;

    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    try {
      const request = JSON.parse(body) as JsonRpcRequest;
      void handleRequest(request);
    } catch (e: any) {
      process.stderr.write(`Parse error: ${e.message}\n`);
    }
  }
});

process.stderr.write(`Interleaved MCP server started for ${OWNER}/${REPO}@${BRANCH}\n`);
