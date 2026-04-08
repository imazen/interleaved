/**
 * Tests for preview modes: entry, site, data file edits.
 *
 * Verifies the renderer correctly handles:
 * - Single content entries (markdown + JSON)
 * - Site index rendering with collection items
 * - Data file edits affecting global context
 */

import { test, expect } from "@playwright/test";
import { SiteRenderer } from "../../lib/renderer";

test.describe("Preview modes", () => {
  let renderer: SiteRenderer;

  test.beforeEach(() => {
    renderer = new SiteRenderer();
    // Standard templates
    renderer.registerTemplate("base", "<html><body><h1>{{title}}</h1>{{{content}}}</body></html>");
    renderer.registerTemplate("post", "<article><h1>{{title}}</h1><time>{{date}}</time>{{{content}}}</article>");
    renderer.registerTemplate("index", "<html><body><h1>{{site.name}}</h1><ul>{{#each posts}}<li><a href=\"{{this.url}}\">{{this.title}}</a></li>{{/each}}</ul></body></html>");
    renderer.registerData("site", { name: "Test Site", description: "A test" });
  });

  test("entry mode: markdown renders through post template", () => {
    const result = renderer.renderMarkdown("posts/hello.md", [
      "---",
      "title: Hello World",
      "date: 2026-04-08",
      "---",
      "Hello **world**!",
    ].join("\n"));

    expect(result.html).toContain("<article>");
    expect(result.html).toContain("Hello World");
    expect(result.html).toContain("<strong>world</strong>");
    expect(result.html).toContain("2026-04-08");
  });

  test("entry mode: JSON content uses base template", () => {
    const result = renderer.renderJson(
      "about.json",
      JSON.stringify({ title: "About Us", layout: "base", content: "<p>info</p>" }),
    );

    expect(result.html).toContain("<h1>About Us</h1>");
  });

  test("data file edit: reregistering data updates index render", () => {
    // Render index with original data
    const items = [
      { html: "", frontmatter: { title: "Post A" }, path: "a.md", outputPath: "a.html" },
    ];
    const original = renderer.renderCollectionIndex("index", items);
    expect(original).toContain("Test Site");

    // Simulate data file edit: re-register with new data
    renderer.registerData("site", { name: "Updated Site Name", description: "new" });

    const updated = renderer.renderCollectionIndex("index", items);
    expect(updated).toContain("Updated Site Name");
    expect(updated).not.toContain("Test Site");
  });

  test("site mode: index renders all collection items", () => {
    const items = [
      { html: "", frontmatter: { title: "First Post", date: "2026-01-01" }, path: "posts/a.md", outputPath: "posts/a.html" },
      { html: "", frontmatter: { title: "Second Post", date: "2026-02-01" }, path: "posts/b.md", outputPath: "posts/b.html" },
      { html: "", frontmatter: { title: "Third Post", date: "2026-03-01" }, path: "posts/c.md", outputPath: "posts/c.html" },
    ];

    const html = renderer.renderCollectionIndex("index", items);

    expect(html).toContain("First Post");
    expect(html).toContain("Second Post");
    expect(html).toContain("Third Post");
    expect(html).toContain("/posts/a.html");
  });

  test("site mode: index handles empty collection", () => {
    const html = renderer.renderCollectionIndex("index", []);
    expect(html).toContain("Test Site");
    // Empty list — no <li> items
    expect(html).toMatch(/<ul>\s*<\/ul>/);
  });

  test("missing index template falls back gracefully", () => {
    const r = new SiteRenderer();
    r.registerTemplate("base", "<html><body>{{site.name}}</body></html>");
    r.registerData("site", { name: "Fallback" });
    // No "index" template — should fall back to base
    const html = r.renderCollectionIndex("index", []);
    // base template doesn't have posts loop, but should still render
    expect(html).toContain("Fallback");
  });

  test("data file path detection: _data/site.json is detected", () => {
    const dataFilePaths = [
      "_data/site.json",
      "data/navigation.json",
      "_data/nested/menu.json",
    ];
    for (const path of dataFilePaths) {
      // Match the same regex used in the preview API
      const isDataFile = !!path.match(/^_?data\//);
      expect(isDataFile).toBe(true);
    }
  });

  test("data file path detection: content paths are not data files", () => {
    const contentPaths = [
      "posts/hello.md",
      "content/about.md",
      "src/content/blog/intro.md",
      "about.json", // single JSON, not in data dir
    ];
    for (const path of contentPaths) {
      const isDataFile = !!path.match(/^_?data\//);
      expect(isDataFile).toBe(false);
    }
  });

  test("nested data references: site.nav array works in templates", () => {
    renderer.registerTemplate("nav", "<nav>{{#each site.nav}}<a href=\"{{this.url}}\">{{this.label}}</a>{{/each}}</nav>");
    renderer.registerData("site", {
      name: "Site",
      nav: [
        { label: "Home", url: "/" },
        { label: "About", url: "/about" },
      ],
    });

    const html = renderer.renderCollectionIndex("nav", []);
    expect(html).toContain('<a href="/">Home</a>');
    expect(html).toContain('<a href="/about">About</a>');
  });

  test("date formatting helper works in index template", () => {
    renderer.registerTemplate("index", "{{#each posts}}<time>{{formatDate this.date}}</time>{{/each}}");

    const items = [
      { html: "", frontmatter: { title: "X", date: "2026-04-08" }, path: "x.md", outputPath: "x.html" },
    ];
    const html = renderer.renderCollectionIndex("index", items);
    expect(html).toContain("April");
    expect(html).toContain("2026");
  });

  test("sortBy helper sorts collection items", () => {
    renderer.registerTemplate("index", "{{#each (sortBy posts \"date\" \"desc\")}}<li>{{this.title}}</li>{{/each}}");

    const items = [
      { html: "", frontmatter: { title: "Old", date: "2025-01-01" }, path: "a.md", outputPath: "a.html" },
      { html: "", frontmatter: { title: "New", date: "2026-01-01" }, path: "b.md", outputPath: "b.html" },
      { html: "", frontmatter: { title: "Mid", date: "2025-06-01" }, path: "c.md", outputPath: "c.html" },
    ];

    const html = renderer.renderCollectionIndex("index", items);
    const newIdx = html.indexOf("New");
    const midIdx = html.indexOf("Mid");
    const oldIdx = html.indexOf("Old");
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });
});
