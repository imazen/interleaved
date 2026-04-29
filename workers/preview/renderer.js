/**
 * Site renderer for the preview worker — LiquidJS + marked.
 *
 * Mirrors lib/renderer/ but in plain JS for the worker bundle. Uses LiquidJS
 * (pure JS, no eval, runs in Cloudflare Workers) so server and worker share
 * the same template syntax and filter set.
 *
 * The filter set is duplicated here as plain JS — keeping it parallel to
 * lib/renderer/filters.ts. A future refactor can collapse them into a single
 * shared module once wrangler's TS bundling is wired across packages.
 */

import { Liquid } from "liquidjs";
import { marked } from "marked";
import * as TOML from "@ltd/j-toml";
import YAML from "yaml";

// ---------- frontmatter parsing ----------

/**
 * Parse frontmatter, auto-detecting format from delimiters.
 *   `+++…+++` → TOML
 *   `---…---` → YAML
 *   `{…}`     → JSON (single-object form)
 */
function parseFrontmatter(content) {
  const head = content.replace(/^﻿/, "").trimStart();

  if (head.startsWith("+++")) {
    const m = content.match(/^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: content };
    const obj = TOML.parse(m[1], 1.0, "\n", false);
    return { frontmatter: JSON.parse(JSON.stringify(obj)), body: m[2] || "" };
  }

  if (head.startsWith("---")) {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: content };
    return {
      frontmatter: YAML.parse(m[1], { strict: false, uniqueKeys: false }) || {},
      body: m[2] || "",
    };
  }

  if (head.startsWith("{")) {
    const m = content.match(/^(\{[\s\S]*?\})\r?\n?([\s\S]*)$/);
    if (!m) return { frontmatter: {}, body: content };
    try {
      return { frontmatter: JSON.parse(m[1]), body: m[2] || "" };
    } catch {
      return { frontmatter: {}, body: content };
    }
  }

  return { frontmatter: {}, body: content };
}

// ---------- filter library (mirror of lib/renderer/filters.ts) ----------

const FILTERS = {
  // comparison
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,

  // logic
  and: (a, b) => Boolean(a) && Boolean(b),
  or: (a, b) => Boolean(a) || Boolean(b),
  not: (a) => !a,

  // string
  lowercase: (s) => String(s ?? "").toLowerCase(),
  uppercase: (s) => String(s ?? "").toUpperCase(),
  capitalize: (s) => {
    const v = String(s ?? "");
    return v.length ? v[0].toUpperCase() + v.slice(1) : v;
  },
  slugify: (s) =>
    String(s ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
  truncate: (s, len = 120, suffix = "…") => {
    const v = String(s ?? "");
    const n = Number(len);
    return v.length <= n ? v : v.slice(0, n) + suffix;
  },
  excerpt: (s, words = 30) => {
    const arr = String(s ?? "").split(/\s+/).filter(Boolean);
    const n = Number(words);
    return arr.length <= n ? arr.join(" ") : arr.slice(0, n).join(" ") + "…";
  },
  replace: (s, from, to) => String(s ?? "").split(String(from ?? "")).join(String(to ?? "")),
  markdownify: (s) => marked.parse(String(s ?? "")),
  markdownify_inline: (s) => marked.parseInline(String(s ?? "")),
  striphtml: (s) => String(s ?? "").replace(/<[^>]*>/g, ""),

  // array
  length: (a) => {
    if (a == null) return 0;
    if (Array.isArray(a) || typeof a === "string") return a.length;
    if (typeof a === "object") return Object.keys(a).length;
    return 0;
  },
  first: (a) => (Array.isArray(a) ? a[0] : undefined),
  last: (a) => (Array.isArray(a) ? a[a.length - 1] : undefined),
  reverse: (a) => (Array.isArray(a) ? [...a].reverse() : a),
  limit: (a, n) => (Array.isArray(a) ? a.slice(0, Number(n)) : a),
  offset: (a, n) => (Array.isArray(a) ? a.slice(Number(n)) : a),
  unique: (a) => (Array.isArray(a) ? Array.from(new Set(a)) : a),
  where: (a, key, val) => {
    if (!Array.isArray(a)) return a;
    const k = String(key);
    if (val === undefined) return a.filter((item) => Boolean(item?.[k]));
    return a.filter((item) => item?.[k] === val);
  },
  sortBy: (a, field, order) => {
    if (!Array.isArray(a)) return a;
    const k = String(field);
    const dir = order === "desc" ? -1 : 1;
    return [...a].sort((x, y) => {
      const xv = x?.[k];
      const yv = y?.[k];
      if (xv == null && yv == null) return 0;
      if (xv == null) return dir;
      if (yv == null) return -dir;
      if (xv < yv) return -dir;
      if (xv > yv) return dir;
      return 0;
    });
  },
  groupBy: (a, field) => {
    if (!Array.isArray(a)) return [];
    const k = String(field);
    const map = new Map();
    for (const item of a) {
      const key = item?.[k];
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => {
        if (a == null && b == null) return 0;
        if (a == null) return 1;
        if (b == null) return -1;
        return a < b ? -1 : a > b ? 1 : 0;
      })
      .map(([key, items]) => ({ key, items }));
  },

  // date
  formatDate: (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(dt);
  },
  dateIso: (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? "" : dt.toISOString();
  },
  year: (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? "" : dt.getUTCFullYear();
  },
  relativeTime: (d) => {
    if (!d) return "";
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    const diffSec = (dt.getTime() - Date.now()) / 1000;
    const fmt = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
    const abs = Math.abs(diffSec);
    if (abs < 60) return fmt.format(Math.round(diffSec), "second");
    if (abs < 3600) return fmt.format(Math.round(diffSec / 60), "minute");
    if (abs < 86400) return fmt.format(Math.round(diffSec / 3600), "hour");
    if (abs < 2592000) return fmt.format(Math.round(diffSec / 86400), "day");
    if (abs < 31536000) return fmt.format(Math.round(diffSec / 2592000), "month");
    return fmt.format(Math.round(diffSec / 31536000), "year");
  },

  // url
  absoluteUrl: (path, base) => {
    const p = String(path ?? "");
    const b = String(base ?? "").replace(/\/+$/, "");
    if (/^https?:\/\//i.test(p)) return p;
    if (!b) return p;
    return p.startsWith("/") ? b + p : b + "/" + p;
  },
  urlencode: (s) => encodeURIComponent(String(s ?? "")),
  relUrl: (target) => String(target ?? "").replace(/^\//, ""),

  // math
  add: (a, b) => Number(a ?? 0) + Number(b ?? 0),
  subtract: (a, b) => Number(a ?? 0) - Number(b ?? 0),
  multiply: (a, b) => Number(a ?? 0) * Number(b ?? 0),
  divide: (a, b) => {
    const d = Number(b ?? 0);
    return d === 0 ? 0 : Number(a ?? 0) / d;
  },
  mod: (a, b) => {
    const d = Number(b ?? 0);
    return d === 0 ? 0 : Number(a ?? 0) % d;
  },
  min: (a, b) => Math.min(Number(a ?? 0), Number(b ?? 0)),
  max: (a, b) => Math.max(Number(a ?? 0), Number(b ?? 0)),
};

// ---------- engine ----------

export class WorkerRenderer {
  constructor() {
    this.partials = new Map();
    this.data = new Map();
    this.templates = new Map();

    this.liquid = new Liquid({
      cache: true,
      fs: {
        readFileSync: (p) => this.lookupPartial(p),
        readFile: async (p) => this.lookupPartial(p),
        existsSync: (p) => this.partials.has(this.normPartialKey(p)),
        exists: async (p) => this.partials.has(this.normPartialKey(p)),
        contains: async () => true,
        resolve: (_root, file) => file,
        fallback: () => undefined,
        sep: "/",
        dirname: (p) => p.split("/").slice(0, -1).join("/"),
      },
    });

    for (const [name, fn] of Object.entries(FILTERS)) {
      this.liquid.registerFilter(name, fn);
    }
  }

  normPartialKey(name) {
    return String(name)
      .replace(/\.(liquid|html|hbs|md|markdown)$/i, "")
      .replace(/^\/+/, "");
  }

  lookupPartial(name) {
    const v = this.partials.get(this.normPartialKey(name));
    if (v == null) throw new Error(`Partial not found: ${name}`);
    return v;
  }

  registerTemplate(name, source) {
    this.templates.set(name, source);
    // Also expose as a partial so other templates can include it by name
    this.partials.set(this.normPartialKey(name), source);
  }

  registerPartial(name, source) {
    this.partials.set(this.normPartialKey(name), source);
  }

  registerData(name, value) {
    this.data.set(name, value);
  }

  getGlobalData() {
    const obj = {};
    for (const [k, v] of this.data) obj[k] = v;
    return obj;
  }

  parseFrontmatter(content) {
    return parseFrontmatter(content);
  }

  resolveLayoutSource(name, fallbacks) {
    const candidates = name ? [name, ...fallbacks] : fallbacks;
    for (const c of candidates) {
      const src = this.templates.get(c);
      if (src) return src;
    }
    return null;
  }

  async renderMarkdown(filePath, content) {
    const { frontmatter, body } = parseFrontmatter(content);
    const bodyHtml = marked.parse(body);

    const source = this.resolveLayoutSource(frontmatter.layout, ["post", "base", "index"]);

    const context = {
      ...this.getGlobalData(),
      ...frontmatter,
      content: bodyHtml,
      body: bodyHtml,
      page: frontmatter,
    };

    const html = source
      ? await this.liquid.parseAndRender(source, context)
      : bodyHtml;

    return { html, frontmatter, path: filePath };
  }

  async renderJson(filePath, content, templateName) {
    let data;
    if (filePath.endsWith(".toml")) {
      const obj = TOML.parse(content, 1.0, "\n", false);
      data = JSON.parse(JSON.stringify(obj));
    } else {
      try {
        data = JSON.parse(content);
      } catch {
        return { html: `<pre>${content}</pre>`, frontmatter: {}, path: filePath };
      }
    }

    const source = this.resolveLayoutSource(
      templateName || data.layout,
      ["base", "index"],
    );

    const context = {
      ...this.getGlobalData(),
      ...data,
      page: data,
    };

    if (!source) {
      return {
        html: `<pre>${JSON.stringify(data, null, 2)}</pre>`,
        frontmatter: data,
        path: filePath,
      };
    }

    const html = await this.liquid.parseAndRender(source, context);
    return { html, frontmatter: data, path: filePath };
  }

  async renderCollectionIndex(templateName, items, collectionName = "posts") {
    let source = this.resolveLayoutSource(templateName, ["index", "base"]);
    if (!source) {
      // Last resort: any registered template
      const first = this.templates.values().next().value;
      if (!first) return "";
      source = first;
    }

    // Sort items by date descending (most common). Templates can re-sort.
    const sorted = [...items].sort((a, b) => {
      const da = new Date(a.frontmatter?.date || 0).getTime();
      const db = new Date(b.frontmatter?.date || 0).getTime();
      return db - da;
    });

    const processed = sorted.map((item) => ({
      ...(item.frontmatter || {}),
      url: `/${(item.path || "").replace(/\.(md|mdx|markdown)$/i, ".html")}`,
      content: item.html || "",
    }));

    const context = {
      ...this.getGlobalData(),
      [collectionName]: processed,
      items: processed,
    };

    return this.liquid.parseAndRender(source, context);
  }
}
