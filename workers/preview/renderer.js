/**
 * Site renderer for the preview worker.
 *
 * Handlebars + marked bundled via wrangler. Mirrors lib/renderer/index.ts
 * but standalone so the worker doesn't depend on the Next.js app bundle.
 */

import Handlebars from "handlebars";
import { marked } from "marked";

export class WorkerRenderer {
  constructor() {
    this.hbs = Handlebars.create();
    this.templates = new Map();
    this.data = new Map();
    this.registerHelpers();
  }

  registerHelpers() {
    this.hbs.registerHelper("formatDate", (dateStr, format) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      if (format === "iso") return d.toISOString();
      return d.toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });
    });

    this.hbs.registerHelper("truncate", (str, len) => {
      if (!str || typeof str !== "string") return "";
      if (str.length <= len) return str;
      return str.slice(0, len) + "...";
    });

    this.hbs.registerHelper("json", (context) => {
      return new Handlebars.SafeString(
        `<pre>${Handlebars.Utils.escapeExpression(JSON.stringify(context, null, 2))}</pre>`,
      );
    });

    this.hbs.registerHelper("md", (text) => {
      if (!text) return "";
      const escaped = Handlebars.Utils.escapeExpression(text);
      return new Handlebars.SafeString(marked.parseInline(escaped));
    });

    this.hbs.registerHelper("eq", (a, b) => a === b);

    this.hbs.registerHelper("slice", (arr, start, end) => {
      if (!Array.isArray(arr)) return [];
      return end !== undefined ? arr.slice(start, end) : arr.slice(start);
    });

    this.hbs.registerHelper("sortBy", (arr, field, order) => {
      if (!Array.isArray(arr)) return [];
      const sorted = [...arr].sort((a, b) => {
        const va = a?.[field];
        const vb = b?.[field];
        if (va < vb) return -1;
        if (va > vb) return 1;
        return 0;
      });
      return order === "desc" ? sorted.reverse() : sorted;
    });
  }

  registerTemplate(name, source) {
    this.templates.set(name, this.hbs.compile(source));
  }

  registerPartial(name, source) {
    this.hbs.registerPartial(name, source);
  }

  registerData(name, value) {
    this.data.set(name, value);
  }

  getGlobalData() {
    const global = {};
    for (const [key, value] of this.data) global[key] = value;
    return global;
  }

  /**
   * Parse YAML-frontmatter markdown. Minimal parser — no full YAML,
   * just the common key: value and list forms.
   */
  parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)/);
    if (!match) return { frontmatter: {}, body: content };

    const frontmatter = {};
    const lines = match[1].split("\n");
    let currentKey = null;
    let currentArray = null;

    for (const line of lines) {
      if (line.match(/^\s*-\s/)) {
        if (currentArray) {
          let value = line.replace(/^\s*-\s*/, "").trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          currentArray.push(value);
        }
        continue;
      }

      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (!kv) continue;

      const [, key, rest] = kv;
      if (rest.trim() === "") {
        // Next lines may be a list
        currentKey = key;
        currentArray = [];
        frontmatter[key] = currentArray;
        continue;
      }

      currentArray = null;
      currentKey = key;
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

  renderMarkdown(filePath, content) {
    const { frontmatter, body } = this.parseFrontmatter(content);
    const bodyHtml = marked.parse(body);

    const layoutName = frontmatter.layout || "post";
    const template = this.templates.get(layoutName)
      || this.templates.get("post")
      || this.templates.get("base");

    const context = {
      ...this.getGlobalData(),
      ...frontmatter,
      content: new Handlebars.SafeString(bodyHtml),
      body: new Handlebars.SafeString(bodyHtml),
      page: frontmatter,
    };

    const html = template ? template(context) : bodyHtml;
    return { html, frontmatter, path: filePath };
  }

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
    const template = this.templates.get(layout) || this.templates.get("base");

    const context = {
      ...this.getGlobalData(),
      ...data,
      page: data,
    };

    const html = template ? template(context) : `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    return { html, frontmatter: data, path: filePath };
  }

  renderCollectionIndex(templateName, items, collectionName = "posts") {
    const template = this.templates.get(templateName)
      || this.templates.get("index")
      || this.templates.get("base");

    if (!template) return "";

    const context = {
      ...this.getGlobalData(),
      [collectionName]: items.map((item) => ({
        ...item.frontmatter,
        url: `/${item.path.replace(/\.(md|mdx|markdown)$/i, ".html")}`,
        content: item.html || "",
      })),
    };

    return template(context);
  }
}
