/**
 * Content-to-URL mapping resolver.
 *
 * Given a file path being previewed, figures out WHICH PAGE to render
 * as the preview output. A JSON data file shouldn't preview as raw JSON
 * — it should preview the page(s) it affects.
 *
 * See templates/default/.interleaved/claude.md for the full spec.
 */

/**
 * Match a file path against a glob pattern like "data/products/*.json".
 * Returns { basename } if matched, null otherwise.
 */
function globMatch(pattern, path) {
  if (!pattern.includes("*")) {
    return pattern === path ? {} : null;
  }
  // Convert glob to regex — only support trailing * for now
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, "([^/]+)");
  const match = path.match(new RegExp(`^${regexStr}$`));
  if (!match) return null;
  // Capture basename without extension
  const basename = (match[1] || "").replace(/\.[^.]+$/, "");
  return { basename };
}

/**
 * Load .interleaved/mapping.json from the tree, if present.
 */
export function loadMapping(blobs) {
  const raw = blobs[".interleaved/mapping.json"];
  if (!raw) return { routes: {}, templateSamples: {} };
  try {
    const parsed = JSON.parse(raw);
    return {
      routes: parsed.routes || {},
      templateSamples: parsed.templateSamples || {},
    };
  } catch {
    return { routes: {}, templateSamples: {} };
  }
}

/**
 * Parse frontmatter from markdown content (minimal parser).
 */
function parseFrontmatterLite(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[kv[1]] = value;
  }
  return fm;
}

/**
 * Parse JSON safely.
 */
function parseJsonLite(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Strip a leading date prefix like "2026-04-01-" from a filename.
 */
function stripDatePrefix(name) {
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

/**
 * Given a content file path, return its default URL based on path conventions.
 */
export function pathToDefaultUrl(path) {
  // Strip common content directory prefixes
  const stripped = path
    .replace(/^content\//, "")
    .replace(/^src\/content\//, "");

  if (/\.(md|mdx|markdown)$/i.test(stripped)) {
    const noExt = stripped.replace(/\.(md|mdx|markdown)$/i, "");
    if (noExt === "index") return "/";

    // Strip date prefix from basename: posts/2026-04-01-hello → posts/hello
    const parts = noExt.split("/");
    const basename = parts[parts.length - 1];
    parts[parts.length - 1] = stripDatePrefix(basename);
    return "/" + parts.join("/") + ".html";
  }

  if (/\.json$/i.test(stripped)) {
    const noExt = stripped.replace(/\.json$/i, "");
    if (noExt === "index") return "/";
    return "/" + noExt + ".html";
  }

  return "/" + stripped;
}

/**
 * Convert a URL path (like "/posts/hello.html") to the content file
 * that would produce it (like "content/posts/hello.md").
 */
export function urlToContentPath(url, tree) {
  if (!url || url === "/") {
    // Index — look for content/index.md, src/content/index.md, or return null
    const candidates = ["content/index.md", "src/content/index.md", "index.md"];
    for (const c of candidates) {
      if (tree.some((e) => e.path === c)) return c;
    }
    return null;
  }

  const clean = url.replace(/^\//, "").replace(/\.html$/, "");
  const candidates = [
    `content/${clean}.md`,
    `content/${clean}.mdx`,
    `src/content/${clean}.md`,
    `${clean}.md`,
  ];
  for (const c of candidates) {
    if (tree.some((e) => e.path === c)) return c;
  }
  return null;
}

/**
 * Resolve what to preview given a file path.
 *
 * Returns:
 *   { mode: "entry", contentPath }     — render a content file directly
 *   { mode: "url", url, contentPath? } — render the page at this URL
 *   { mode: "index" }                   — render the site index
 */
export function resolvePreview(filePath, blobs, mapping, tree) {
  // 1. Check mapping.json routes
  if (mapping.routes) {
    for (const [pattern, route] of Object.entries(mapping.routes)) {
      const match = globMatch(pattern, filePath);
      if (match) {
        // Substitute {basename} etc. in route
        const url = route.replace(/\{basename\}/g, match.basename || "");
        const contentPath = urlToContentPath(url, tree);
        return { mode: "url", url, contentPath };
      }
    }
  }

  // 2. Template files: check templateSamples
  if (filePath.startsWith("templates/") || filePath.startsWith("_layouts/")) {
    if (mapping.templateSamples) {
      const sample = mapping.templateSamples[filePath];
      if (sample === null) return { mode: "index" };
      if (typeof sample === "string") {
        return { mode: "entry", contentPath: sample };
      }
    }
    // Default: render index for templates
    return { mode: "index" };
  }

  // 3. Data files: check frontmatter for _preview, else render index
  if (filePath.match(/^_?data\//) && filePath.endsWith(".json")) {
    const content = blobs[filePath];
    if (content) {
      const data = parseJsonLite(content);
      if (data && typeof data._preview === "string") {
        const url = data._preview;
        const contentPath = urlToContentPath(url, tree);
        if (contentPath) return { mode: "entry", contentPath };
        return { mode: "url", url };
      }
    }
    return { mode: "index" };
  }

  // 4. Content markdown files: check frontmatter for url/_preview
  if (/\.(md|mdx|markdown)$/i.test(filePath)) {
    const content = blobs[filePath];
    if (content) {
      const fm = parseFrontmatterLite(content);
      if (fm._preview) {
        const contentPath = urlToContentPath(fm._preview, tree);
        if (contentPath) return { mode: "entry", contentPath };
        return { mode: "url", url: fm._preview };
      }
    }
    return { mode: "entry", contentPath: filePath };
  }

  // 5. Standalone JSON content files (non-data): render directly as entry
  if (filePath.endsWith(".json")) {
    return { mode: "entry", contentPath: filePath };
  }

  // 6. Unknown file type — render index
  return { mode: "index" };
}
