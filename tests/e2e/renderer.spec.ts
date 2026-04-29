/**
 * Tests for the isomorphic Liquid + marked renderer.
 *
 * These run the renderer directly in Node (not through the browser),
 * verifying the core rendering pipeline works correctly.
 */

import { test, expect } from "@playwright/test";
import { SiteRenderer } from "../../lib/renderer";

test.describe("SiteRenderer", () => {
  let renderer: SiteRenderer;

  test.beforeEach(() => {
    renderer = new SiteRenderer();
  });

  test("renders markdown to HTML", async () => {
    renderer.registerTemplate("post", "<article>{{ content }}</article>");

    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: Hello",
      "---",
      "# Heading",
      "",
      "Some **bold** text.",
    ].join("\n"));

    expect(result.html).toContain("<h1>Heading</h1>");
    expect(result.html).toContain("<strong>bold</strong>");
    expect(result.html).toContain("<article>");
    expect(result.frontmatter.title).toBe("Hello");
    expect(result.outputPath).toBe("test.html");
  });

  test("renders frontmatter variables in template", async () => {
    renderer.registerTemplate("post", "<h1>{{ title }}</h1>{{ content }}");

    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: My Post",
      "---",
      "Body text.",
    ].join("\n"));

    expect(result.html).toContain("<h1>My Post</h1>");
    expect(result.html).toContain("<p>Body text.</p>");
  });

  test("uses layout from frontmatter", async () => {
    renderer.registerTemplate("base", "<div class=\"base\">{{ content }}</div>");
    renderer.registerTemplate("post", "<div class=\"post\">{{ content }}</div>");
    renderer.registerTemplate("page", "<div class=\"page\">{{ content }}</div>");

    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: About",
      "layout: page",
      "---",
      "About content.",
    ].join("\n"));

    expect(result.html).toContain("class=\"page\"");
    expect(result.html).not.toContain("class=\"post\"");
  });

  test("falls back to post then base template", async () => {
    renderer.registerTemplate("base", "<div class=\"base\">{{ content }}</div>");

    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: Test",
      "---",
      "Content.",
    ].join("\n"));

    expect(result.html).toContain("class=\"base\"");
  });

  test("registers and renders partials", async () => {
    renderer.registerPartial("header", "<header>{{ site.name }}</header>");
    renderer.registerTemplate("post", "{% include \"header\" %}<main>{{ content }}</main>");
    renderer.registerData("site", { name: "Test Site" });

    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: Test",
      "---",
      "Hello.",
    ].join("\n"));

    expect(result.html).toContain("<header>Test Site</header>");
    expect(result.html).toContain("<main>");
  });

  test("global data is available in templates", async () => {
    renderer.registerTemplate("post", "<span>{{ site.name }}</span>{{ content }}");
    renderer.registerData("site", { name: "My Blog" });

    const result = await renderer.renderMarkdown("test.md", "---\ntitle: X\n---\nHi.");

    expect(result.html).toContain("<span>My Blog</span>");
  });

  test("renders JSON content", async () => {
    renderer.registerTemplate("base", "<h1>{{ name }}</h1><p>{{ bio }}</p>");

    const result = await renderer.renderJson(
      "about.json",
      JSON.stringify({ name: "Alice", bio: "Developer" }),
    );

    expect(result.html).toContain("<h1>Alice</h1>");
    expect(result.html).toContain("<p>Developer</p>");
    expect(result.outputPath).toBe("about.html");
  });

  test("renders TOML content", async () => {
    renderer.registerTemplate("base", "<h1>{{ name }}</h1>");

    const result = await renderer.renderJson(
      "about.toml",
      'name = "Alice"\nbio = "Developer"',
    );

    expect(result.html).toContain("<h1>Alice</h1>");
    expect(result.outputPath).toBe("about.html");
  });

  test("renders collection index", async () => {
    renderer.registerTemplate(
      "index",
      "{% for post in posts %}<li>{{ post.title }}</li>{% endfor %}",
    );

    const pages = [
      {
        html: "<p>A</p>",
        frontmatter: { title: "Post A", date: "2026-01-01" },
        path: "posts/a.md",
        outputPath: "posts/a.html",
      },
      {
        html: "<p>B</p>",
        frontmatter: { title: "Post B", date: "2026-02-01" },
        path: "posts/b.md",
        outputPath: "posts/b.html",
      },
    ];

    const html = await renderer.renderCollectionIndex("index", pages);

    expect(html).toContain("<li>Post A</li>");
    expect(html).toContain("<li>Post B</li>");
  });

  test("formatDate filter works", async () => {
    renderer.registerTemplate(
      "post",
      "<time>{{ date | formatDate }}</time>{{ content }}",
    );

    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: Test",
      "date: 2026-04-07",
      "---",
      "Hi.",
    ].join("\n"));

    expect(result.html).toContain("<time>");
    expect(result.html).toContain("April");
    expect(result.html).toContain("2026");
  });

  test("truncate filter works", async () => {
    renderer.registerTemplate(
      "post",
      "<p>{{ description | truncate: 20 }}</p>{{ content }}",
    );

    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: Test",
      "description: This is a very long description that should be truncated",
      "---",
      "Hi.",
    ].join("\n"));

    expect(result.html).toContain("…");
    expect(result.html).not.toContain("truncated");
  });

  test("sortBy filter works", async () => {
    renderer.registerTemplate(
      "index",
      "{% assign sorted = posts | sortBy: \"title\" %}{% for post in sorted %}<li>{{ post.title }}</li>{% endfor %}",
    );

    const pages = [
      { html: "", frontmatter: { title: "Zebra" }, path: "z.md", outputPath: "z.html" },
      { html: "", frontmatter: { title: "Apple" }, path: "a.md", outputPath: "a.html" },
    ];

    const html = await renderer.renderCollectionIndex("index", pages);

    const appleIdx = html.indexOf("Apple");
    const zebraIdx = html.indexOf("Zebra");
    expect(appleIdx).toBeLessThan(zebraIdx);
  });

  test("renders without template (raw HTML)", async () => {
    const result = await renderer.renderMarkdown("test.md", [
      "---",
      "title: Raw",
      "---",
      "**Bold** text.",
    ].join("\n"));

    expect(result.html).toContain("<strong>Bold</strong>");
    expect(result.html).not.toContain("{{");
  });

  test("output path conversion", async () => {
    const result = await renderer.renderMarkdown(
      "posts/2026-04-07-hello.md",
      "---\ntitle: Hello\n---\nHi.",
    );

    expect(result.outputPath).toBe("posts/2026-04-07-hello.html");
  });

  test("TOML frontmatter (+++ delimiters)", async () => {
    renderer.registerTemplate("post", "<h1>{{ title }}</h1>{{ content }}");

    const result = await renderer.renderMarkdown("test.md", [
      "+++",
      "title = \"Hello from TOML\"",
      "+++",
      "Body.",
    ].join("\n"));

    expect(result.html).toContain("<h1>Hello from TOML</h1>");
    expect(result.frontmatter.title).toBe("Hello from TOML");
  });
});
