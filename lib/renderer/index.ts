/**
 * Isomorphic site renderer — Handlebars + marked.
 *
 * Renders markdown content with YAML frontmatter through Handlebars HTML
 * templates. Works identically in browser and Node.js.
 *
 * Usage:
 *   const renderer = new SiteRenderer();
 *   renderer.registerTemplate("base", baseHtml);
 *   renderer.registerPartial("header", headerHtml);
 *   renderer.registerData("site", siteJson);
 *   const html = renderer.renderContent("posts/hello.md", markdownString);
 */

import Handlebars from "handlebars";
import { marked } from "marked";
import { parse } from "@/lib/serialization";

export type RenderedPage = {
  html: string;
  frontmatter: Record<string, unknown>;
  path: string;
  outputPath: string;
};

export type SiteData = Record<string, unknown>;

export class SiteRenderer {
  private hbs: typeof Handlebars;
  private templates: Map<string, HandlebarsTemplateDelegate> = new Map();
  private data: Map<string, unknown> = new Map();

  constructor() {
    this.hbs = Handlebars.create();
    this.registerHelpers();
  }

  private registerHelpers() {
    // Date formatting helper
    this.hbs.registerHelper("formatDate", (dateStr: string, format?: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      if (format === "iso") return d.toISOString();
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    });

    // Truncate text
    this.hbs.registerHelper("truncate", (str: string, len: number) => {
      if (!str || typeof str !== "string") return "";
      if (str.length <= len) return str;
      return str.slice(0, len) + "...";
    });

    // JSON stringify for debug
    this.hbs.registerHelper("json", (context: unknown) => {
      return new Handlebars.SafeString(
        `<pre>${Handlebars.Utils.escapeExpression(JSON.stringify(context, null, 2))}</pre>`,
      );
    });

    // Markdown inline rendering (for descriptions etc.)
    // Escape HTML first to prevent XSS in frontmatter values rendered inline.
    this.hbs.registerHelper("md", (text: string) => {
      if (!text) return "";
      const escaped = Handlebars.Utils.escapeExpression(text);
      return new Handlebars.SafeString(marked.parseInline(escaped) as string);
    });

    // Equality check
    this.hbs.registerHelper("eq", (a: unknown, b: unknown) => a === b);

    // Array slice
    this.hbs.registerHelper("slice", (arr: unknown[], start: number, end?: number) => {
      if (!Array.isArray(arr)) return [];
      return end !== undefined ? arr.slice(start, end) : arr.slice(start);
    });

    // Sort array by field
    this.hbs.registerHelper("sortBy", (arr: unknown[], field: string, order?: string) => {
      if (!Array.isArray(arr)) return [];
      const sorted = [...arr].sort((a: any, b: any) => {
        const va = a?.[field];
        const vb = b?.[field];
        if (va < vb) return -1;
        if (va > vb) return 1;
        return 0;
      });
      return order === "desc" ? sorted.reverse() : sorted;
    });
  }

  /** Register an HTML template by name. */
  registerTemplate(name: string, source: string) {
    this.templates.set(name, this.hbs.compile(source));
  }

  /** Register a Handlebars partial (reusable fragment). */
  registerPartial(name: string, source: string) {
    this.hbs.registerPartial(name, source);
  }

  /** Register global data (e.g., site.json). */
  registerData(name: string, value: unknown) {
    this.data.set(name, value);
  }

  /** Get the global data object passed to every template. */
  private getGlobalData(): Record<string, unknown> {
    const global: Record<string, unknown> = {};
    for (const [key, value] of this.data) {
      global[key] = value;
    }
    return global;
  }

  /**
   * Render a markdown content file.
   *
   * 1. Parses YAML frontmatter
   * 2. Converts markdown body to HTML via marked
   * 3. Selects template (from frontmatter `layout` or fallback to "post" then "base")
   * 4. Renders through Handlebars with frontmatter + global data
   */
  renderMarkdown(filePath: string, content: string): RenderedPage {
    const parsed = parse(content, { format: "yaml-frontmatter" });
    const frontmatter = { ...parsed } as Record<string, unknown>;
    const body = (frontmatter.body as string) || "";
    delete frontmatter.body;

    const bodyHtml = marked.parse(body) as string;

    // Select template: frontmatter.layout > "post" > "base" > identity
    const layoutName = (frontmatter.layout as string) || "post";
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

    const html = template
      ? template(context)
      : bodyHtml;

    const outputPath = filePath
      .replace(/\.(md|mdx|markdown)$/i, ".html")
      .replace(/\/index\.html$/, "/index.html");

    return { html, frontmatter, path: filePath, outputPath };
  }

  /**
   * Render a JSON data file through a template.
   * The JSON object becomes the template context.
   */
  renderJson(filePath: string, content: string, templateName?: string): RenderedPage {
    const data = JSON.parse(content);
    const layout = templateName || data.layout || "base";
    const template = this.templates.get(layout) || this.templates.get("base");

    const context = {
      ...this.getGlobalData(),
      ...data,
      page: data,
    };

    const html = template ? template(context) : JSON.stringify(data, null, 2);
    const outputPath = filePath.replace(/\.json$/i, ".html");

    return { html, frontmatter: data, path: filePath, outputPath };
  }

  /**
   * Render a collection index page.
   * Passes all collection items as `posts` (or a custom name) to the template.
   */
  renderCollectionIndex(
    templateName: string,
    items: RenderedPage[],
    collectionName: string = "posts",
  ): string {
    const template = this.templates.get(templateName)
      || this.templates.get("index")
      || this.templates.get("base");

    if (!template) return "";

    const context = {
      ...this.getGlobalData(),
      [collectionName]: items.map((item) => ({
        ...item.frontmatter,
        url: `/${item.outputPath}`,
        content: item.html,
      })),
    };

    return template(context);
  }
}
