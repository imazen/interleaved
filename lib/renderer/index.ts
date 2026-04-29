/**
 * Isomorphic site renderer — LiquidJS + marked.
 *
 * Renders markdown / JSON content through Liquid templates. The template
 * engine is pluggable via the TemplateEngine interface; the default impl
 * is LiquidJS (pure-JS, runs in Node and Cloudflare Workers identically).
 * A future Rust+WASM engine can drop in via the same interface.
 *
 * Frontmatter auto-detects format from delimiters: `+++` → TOML, `---` →
 * YAML, `{…}` → JSON.
 *
 * Usage:
 *   const renderer = new SiteRenderer();
 *   renderer.registerTemplate("base", baseHtml);
 *   renderer.registerPartial("header", headerHtml);
 *   renderer.registerData("site", siteData);
 *   const out = await renderer.renderMarkdown("posts/hello.md", source);
 */

import { marked } from "marked";
import { parse } from "../serialization";
import { LiquidEngine } from "./liquid-engine";
import { registerSiteFilters } from "./filters";
import type { TemplateEngine } from "./engine";

export type RenderedPage = {
  html: string;
  frontmatter: Record<string, unknown>;
  path: string;
  outputPath: string;
};

export type SiteData = Record<string, unknown>;

export class SiteRenderer {
  private engine: TemplateEngine;
  private templateNames = new Set<string>();
  private data: Map<string, unknown> = new Map();

  /**
   * @param engine Optional engine override. Defaults to LiquidEngine. Tests
   *   and a future WASM engine plug in here.
   */
  constructor(engine?: TemplateEngine) {
    this.engine = engine ?? new LiquidEngine();
    registerSiteFilters(this.engine);
  }

  /** Register an HTML template by name. */
  registerTemplate(name: string, source: string): void {
    this.engine.registerTemplate(name, source);
    this.templateNames.add(name);
  }

  /** Register a partial (reusable fragment) included via `{%- include "name" -%}`. */
  registerPartial(name: string, source: string): void {
    this.engine.registerPartial(name, source);
  }

  /** Register global data (e.g. site, nav). Becomes available as `{{ name.field }}` in every template. */
  registerData(name: string, value: unknown): void {
    this.data.set(name, value);
  }

  private getGlobalData(): Record<string, unknown> {
    const global: Record<string, unknown> = {};
    for (const [key, value] of this.data) global[key] = value;
    return global;
  }

  /**
   * Pick a layout name from frontmatter, falling back through a list of
   * defaults. Returns null when no registered template matches.
   */
  private resolveLayout(name: string | undefined, fallbacks: string[]): string | null {
    const candidates = name ? [name, ...fallbacks] : fallbacks;
    for (const c of candidates) {
      if (this.templateNames.has(c)) return c;
    }
    return null;
  }

  /**
   * Render a markdown content file.
   *
   * 1. Parses frontmatter (TOML/YAML/JSON auto-detected)
   * 2. Converts markdown body to HTML via marked
   * 3. Selects template (frontmatter.layout > "post" > "base" > raw body)
   * 4. Renders through the engine with frontmatter + global data
   */
  async renderMarkdown(filePath: string, content: string): Promise<RenderedPage> {
    const parsed = parse(content) as Record<string, unknown>;
    const frontmatter = { ...parsed };
    const body = (frontmatter.body as string) ?? "";
    delete frontmatter.body;

    const bodyHtml = marked.parse(body) as string;

    const layout = this.resolveLayout(
      frontmatter.layout as string | undefined,
      ["post", "base"],
    );

    const context = {
      ...this.getGlobalData(),
      ...frontmatter,
      content: bodyHtml,
      body: bodyHtml,
      page: frontmatter,
    };

    const html = layout
      ? await this.engine.render(layout, context)
      : bodyHtml;

    const outputPath = filePath.replace(/\.(md|mdx|markdown)$/i, ".html");
    return { html, frontmatter, path: filePath, outputPath };
  }

  /**
   * Render a JSON or TOML data file as a page. The parsed object becomes
   * the template context.
   */
  async renderJson(filePath: string, content: string, templateName?: string): Promise<RenderedPage> {
    const data = parse(content, {
      format: filePath.endsWith(".toml") ? "toml" : "json",
    }) as Record<string, unknown>;

    const layout = this.resolveLayout(
      templateName ?? (data.layout as string | undefined),
      ["base", "index"],
    );

    const context = {
      ...this.getGlobalData(),
      ...data,
      page: data,
    };

    const html = layout
      ? await this.engine.render(layout, context)
      : JSON.stringify(data, null, 2);

    const outputPath = filePath.replace(/\.(json|toml)$/i, ".html");
    return { html, frontmatter: data, path: filePath, outputPath };
  }

  /**
   * Render a collection index page.
   * Passes all collection items as `posts` (or a custom name) to the template.
   */
  async renderCollectionIndex(
    templateName: string,
    items: RenderedPage[],
    collectionName: string = "posts",
  ): Promise<string> {
    const layout = this.resolveLayout(templateName, ["index", "base"]);
    if (!layout) return "";

    const context = {
      ...this.getGlobalData(),
      [collectionName]: items.map((item) => ({
        ...item.frontmatter,
        url: `/${item.outputPath}`,
        content: item.html,
      })),
    };

    return this.engine.render(layout, context);
  }
}
