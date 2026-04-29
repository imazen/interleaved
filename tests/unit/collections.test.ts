/**
 * Unit tests for SiteRenderer's content registration + derived collections.
 *
 * site.posts / site.pages / site.categories / site.tags are exposed as
 * render globals so Liquid templates can iterate them — the Jekyll
 * convention. Top-level `posts` and `pages` aliases are also exposed for
 * brevity.
 */

import { describe, it, expect } from "vitest";
import { SiteRenderer } from "../../lib/renderer";

function makeRenderer() {
  const r = new SiteRenderer();
  r.registerData("site", { name: "Test Site" });
  return r;
}

describe("SiteRenderer collections", () => {
  it("classifies content under posts/ as site.posts", async () => {
    const r = makeRenderer();
    r.registerContent("posts/hello.md", { title: "Hello", date: "2026-01-01" });
    r.registerContent("about.md", { title: "About" });

    r.registerTemplate(
      "base",
      "<p>posts={{ site.posts | length }}</p><p>pages={{ site.pages | length }}</p>",
    );
    const out = await r.renderMarkdown("about.md", "---\ntitle: About\n---\nbody");
    expect(out.html).toContain("posts=1");
    expect(out.html).toContain("pages=1");
  });

  it("explicit collection: posts overrides path classification", async () => {
    const r = makeRenderer();
    r.registerContent("articles/ai.md", { title: "AI", collection: "posts" });
    r.registerTemplate("base", "{{ site.posts | length }}");
    const out = await r.renderMarkdown("articles/ai.md", "");
    expect(out.html).toBe("1");
  });

  it("groups by categories", async () => {
    const r = makeRenderer();
    r.registerContent("posts/a.md", { title: "A", categories: ["news"] });
    r.registerContent("posts/b.md", { title: "B", categories: ["news", "press"] });
    r.registerContent("posts/c.md", { title: "C", categories: ["tutorials"] });

    r.registerTemplate(
      "base",
      "news={{ site.categories.news | length }}|press={{ site.categories.press | length }}|tutorials={{ site.categories.tutorials | length }}",
    );
    const out = await r.renderMarkdown("posts/a.md", "");
    expect(out.html).toContain("news=2");
    expect(out.html).toContain("press=1");
    expect(out.html).toContain("tutorials=1");
  });

  it("groups by tags independently of categories", async () => {
    const r = makeRenderer();
    r.registerContent("posts/x.md", { title: "X", tags: ["rust", "perf"] });
    r.registerContent("posts/y.md", { title: "Y", tags: ["perf"] });

    r.registerTemplate(
      "base",
      "rust={{ site.tags.rust | length }}|perf={{ site.tags.perf | length }}",
    );
    const out = await r.renderMarkdown("posts/x.md", "");
    expect(out.html).toContain("rust=1");
    expect(out.html).toContain("perf=2");
  });

  it("entries carry url + path + frontmatter through to templates", async () => {
    const r = makeRenderer();
    r.registerContent("posts/hello.md", { title: "Hello" });

    r.registerTemplate(
      "base",
      "{% for p in site.posts %}{{ p.title }} @ {{ p.url }} ({{ p.path }}){% endfor %}",
    );
    const out = await r.renderMarkdown("posts/hello.md", "");
    expect(out.html).toBe("Hello @ /posts/hello.html (posts/hello.md)");
  });

  it("top-level posts/pages aliases work", async () => {
    const r = makeRenderer();
    r.registerContent("posts/a.md", { title: "A" });
    r.registerContent("about.md", { title: "About" });

    r.registerTemplate("base", "p={{ posts | length }}|g={{ pages | length }}");
    const out = await r.renderMarkdown("about.md", "");
    expect(out.html).toBe("p=1|g=1");
  });

  it("user-provided site data merges, but our collections win", async () => {
    const r = new SiteRenderer();
    r.registerData("site", { name: "X", posts: ["should-be-overridden"] });
    r.registerContent("posts/real.md", { title: "Real" });

    r.registerTemplate("base", "name={{ site.name }}|posts={{ site.posts | length }}");
    const out = await r.renderMarkdown("posts/real.md", "");
    expect(out.html).toContain("name=X");
    expect(out.html).toContain("posts=1");
  });
});
