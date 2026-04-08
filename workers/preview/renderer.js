/**
 * Site renderer for the preview worker — Mustache + marked.
 *
 * Uses Mustache (not Handlebars) because Cloudflare Workers block
 * dynamic code generation (`new Function`, `eval`), which Handlebars
 * requires for template compilation. Mustache is pure string parsing.
 *
 * Mustache is logic-less by design:
 * - {{var}} → escaped
 * - {{{var}}} → unescaped
 * - {{#section}}...{{/section}} → iteration / truthy check
 * - {{^section}}...{{/section}} → inverted / falsy check
 * - {{> partial}} → partial
 * - No inline helpers — preprocess data before rendering.
 */

import Mustache from "mustache";
import { marked } from "marked";
import { handlebarsToMustache } from "./compat.js";

// Don't HTML-escape within sections that we've already marked safe
Mustache.escape = (text) => {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function formatDate(input) {
  if (!input) return "";
  const d = new Date(input);
  if (isNaN(d.getTime())) return String(input);
  return DATE_FMT.format(d);
}

function truncate(text, len = 120) {
  if (!text || typeof text !== "string") return "";
  if (text.length <= len) return text;
  return text.slice(0, len) + "...";
}

function stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Preprocess a data object so templates can use formatted/computed values
 * without needing Handlebars-style helpers. Attaches:
 *   _formatted: pre-computed versions of common fields
 *   _truncated_120: first 120 chars of string fields
 */
function preprocessData(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(preprocessData);
  if (typeof obj !== "object") return obj;
  if (obj instanceof Date) return obj;

  const result = { ...obj };

  // Pre-format date-looking fields
  const dateFields = ["date", "publishedAt", "published", "created", "updated", "modifiedAt"];
  for (const key of dateFields) {
    if (obj[key] && typeof obj[key] === "string") {
      result[`${key}_formatted`] = formatDate(obj[key]);
      result[`${key}_iso`] = new Date(obj[key]).toISOString();
    }
  }

  // Pre-truncate description fields
  const textFields = ["description", "summary", "excerpt", "body"];
  for (const key of textFields) {
    if (obj[key] && typeof obj[key] === "string") {
      result[`${key}_truncated`] = truncate(obj[key], 120);
    }
  }

  // Recurse into nested objects/arrays
  for (const key of Object.keys(result)) {
    if (key.endsWith("_formatted") || key.endsWith("_iso") || key.endsWith("_truncated")) continue;
    if (typeof result[key] === "object" && result[key] !== null) {
      result[key] = preprocessData(result[key]);
    }
  }

  return result;
}

export class WorkerRenderer {
  constructor() {
    this.templates = new Map();
    this.partials = {}; // Mustache.render expects an object
    this.data = new Map();
  }

  registerTemplate(name, source) {
    const compat = handlebarsToMustache(source);
    this.templates.set(name, compat);
    // Also make templates usable as partials via their name
    this.partials[name] = compat;
  }

  registerPartial(name, source) {
    this.partials[name] = handlebarsToMustache(source);
  }

  registerData(name, value) {
    this.data.set(name, preprocessData(value));
  }

  getGlobalData() {
    const global = {};
    for (const [key, value] of this.data) global[key] = value;
    return global;
  }

  /**
   * Parse YAML frontmatter from markdown content (minimal parser).
   */
  parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)/);
    if (!match) return { frontmatter: {}, body: content };

    const frontmatter = {};
    const lines = match[1].split("\n");
    let currentArrayKey = null;

    for (const line of lines) {
      if (line.match(/^\s+-\s/) && currentArrayKey) {
        let value = line.replace(/^\s+-\s*/, "").trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        frontmatter[currentArrayKey].push(value);
        continue;
      }

      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (!kv) continue;

      const [, key, rest] = kv;
      if (rest.trim() === "") {
        currentArrayKey = key;
        frontmatter[key] = [];
        continue;
      }

      currentArrayKey = null;
      let value = rest.trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (value === "true") frontmatter[key] = true;
      else if (value === "false") frontmatter[key] = false;
      else if (/^-?\d+(\.\d+)?$/.test(value)) frontmatter[key] = Number(value);
      else frontmatter[key] = value;
    }

    return { frontmatter, body: match[2] || "" };
  }

  /**
   * Render a markdown content file through its layout template.
   */
  renderMarkdown(filePath, content) {
    const { frontmatter, body } = this.parseFrontmatter(content);
    const bodyHtml = marked.parse(body);

    const layoutName = frontmatter.layout || "post";
    const source =
      this.templates.get(layoutName) ||
      this.templates.get("post") ||
      this.templates.get("base") ||
      this.templates.get("index");

    const processed = preprocessData(frontmatter);
    const context = {
      ...this.getGlobalData(),
      ...processed,
      content: bodyHtml,
      body: bodyHtml,
      page: processed,
    };

    const html = source
      ? Mustache.render(source, context, this.partials)
      : bodyHtml;

    return { html, frontmatter, path: filePath };
  }

  /**
   * Render a JSON data file. Falls back to rendering through a layout if
   * one is specified, else returns a pretty-printed JSON display.
   */
  renderJson(filePath, content, templateName) {
    let data;
    try {
      data = JSON.parse(content);
    } catch {
      return {
        html: `<pre>${content}</pre>`,
        frontmatter: {},
        path: filePath,
      };
    }

    const layout = templateName || data.layout || "base";
    const source =
      this.templates.get(layout) ||
      this.templates.get("base") ||
      this.templates.get("index");

    const processed = preprocessData(data);
    const context = {
      ...this.getGlobalData(),
      ...processed,
      page: processed,
    };

    if (!source) {
      return {
        html: `<pre>${JSON.stringify(data, null, 2)}</pre>`,
        frontmatter: data,
        path: filePath,
      };
    }

    const html = Mustache.render(source, context, this.partials);
    return { html, frontmatter: data, path: filePath };
  }

  /**
   * Render the site's index template with all collection items available
   * as `posts` (or a custom key).
   */
  renderCollectionIndex(templateName, items, collectionName = "posts") {
    const source =
      this.templates.get(templateName) ||
      this.templates.get("index") ||
      this.templates.get("index.html") ||
      this.templates.get("base") ||
      this.templates.get("base.html") ||
      (this.templates.size > 0 ? this.templates.values().next().value : null);

    if (!source) return "";

    // Sort items by date descending (most recent first) since that's the
    // most common use case. Template can re-sort if needed.
    const sortedItems = [...items].sort((a, b) => {
      const da = new Date(a.frontmatter?.date || 0).getTime();
      const db = new Date(b.frontmatter?.date || 0).getTime();
      return db - da;
    });

    const processed = sortedItems.map((item) => {
      const fm = preprocessData(item.frontmatter || {});
      return {
        ...fm,
        url: `/${(item.path || "").replace(/\.(md|mdx|markdown)$/i, ".html")}`,
        content: item.html || "",
      };
    });

    const context = {
      ...this.getGlobalData(),
      [collectionName]: processed,
      // Also expose under `items` for templates that don't want to assume a name
      items: processed,
    };

    return Mustache.render(source, context, this.partials);
  }
}
