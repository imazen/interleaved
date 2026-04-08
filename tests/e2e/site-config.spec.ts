/**
 * Tests for .interleaved/config.json parsing and auto-detection.
 */

import { test, expect } from "@playwright/test";
import { parseSiteConfig, detectGenerator, resolvePreviewUrl } from "../../lib/site-config";

test.describe("parseSiteConfig", () => {
  test("returns defaults for empty config", () => {
    const config = parseSiteConfig({});
    expect(config.workflow).toBe("direct");
    expect(config.defaultBranch).toBe("main");
    expect(config.draftBranch).toBe("draft");
    expect(config.preview.mode).toBe("builtin");
    expect(config.generator).toBe("handlebars");
    expect(config.mediaOutput).toBe("/images");
  });

  test("parses workflow mode", () => {
    expect(parseSiteConfig({ workflow: "branch" }).workflow).toBe("branch");
    expect(parseSiteConfig({ workflow: "direct" }).workflow).toBe("direct");
    expect(parseSiteConfig({ workflow: "invalid" }).workflow).toBe("direct");
  });

  test("parses branch names", () => {
    const config = parseSiteConfig({
      defaultBranch: "production",
      draftBranch: "staging",
    });
    expect(config.defaultBranch).toBe("production");
    expect(config.draftBranch).toBe("staging");
  });

  test("parses preview config", () => {
    const config = parseSiteConfig({
      preview: {
        mode: "deploy",
        urlTemplate: "https://{branch}--my-site.netlify.app",
        waitTimeout: 60000,
      },
    });
    expect(config.preview.mode).toBe("deploy");
    expect(config.preview.urlTemplate).toBe("https://{branch}--my-site.netlify.app");
    expect(config.preview.waitTimeout).toBe(60000);
  });

  test("parses generator type", () => {
    expect(parseSiteConfig({ generator: "astro" }).generator).toBe("astro");
    expect(parseSiteConfig({ generator: "hugo" }).generator).toBe("hugo");
    expect(parseSiteConfig({ generator: "eleventy" }).generator).toBe("eleventy");
    expect(parseSiteConfig({ generator: "nextjs" }).generator).toBe("nextjs");
    expect(parseSiteConfig({ generator: "bogus" }).generator).toBe("handlebars");
  });

  test("auto-sets preview to deploy for non-handlebars generators with URL template", () => {
    const config = parseSiteConfig({
      generator: "astro",
      deploy: { platform: "netlify", siteId: "my-site" },
    });
    expect(config.preview.mode).toBe("deploy");
    expect(config.preview.urlTemplate).toContain("netlify.app");
  });

  test("auto-sets preview to none for non-handlebars generators without URL", () => {
    const config = parseSiteConfig({
      generator: "hugo",
    });
    expect(config.preview.mode).toBe("none");
  });

  test("parses deploy platform", () => {
    const config = parseSiteConfig({
      deploy: { platform: "vercel", siteId: "my-project" },
    });
    expect(config.deploy?.platform).toBe("vercel");
    expect(config.deploy?.siteId).toBe("my-project");
  });

  test("ignores unknown fields", () => {
    const config = parseSiteConfig({
      unknownField: "whatever",
      workflow: "branch",
    });
    expect(config.workflow).toBe("branch");
  });
});

test.describe("detectGenerator", () => {
  test("detects Astro", () => {
    expect(detectGenerator(["astro.config.mjs", "package.json", "src"])).toBe("astro");
    expect(detectGenerator(["astro.config.ts", "tsconfig.json"])).toBe("astro");
  });

  test("detects Hugo", () => {
    expect(detectGenerator(["hugo.toml", "content", "layouts"])).toBe("hugo");
    expect(detectGenerator(["config.toml", "content"])).toBe("hugo");
  });

  test("detects Eleventy", () => {
    expect(detectGenerator([".eleventy.js", "src"])).toBe("eleventy");
    expect(detectGenerator(["eleventy.config.js"])).toBe("eleventy");
    expect(detectGenerator(["eleventy.config.mjs"])).toBe("eleventy");
  });

  test("detects Next.js", () => {
    expect(detectGenerator(["next.config.js", "pages"])).toBe("nextjs");
    expect(detectGenerator(["next.config.mjs"])).toBe("nextjs");
  });

  test("detects Nuxt", () => {
    expect(detectGenerator(["nuxt.config.ts"])).toBe("nuxt");
  });

  test("detects Jekyll", () => {
    expect(detectGenerator(["_config.yml", "_posts"])).toBe("jekyll");
    expect(detectGenerator(["Gemfile", "_config.yml"])).toBe("jekyll");
  });

  test("returns handlebars for unknown", () => {
    expect(detectGenerator(["index.html", "style.css"])).toBe("handlebars");
    expect(detectGenerator(["templates", "content"])).toBe("handlebars");
  });
});

test.describe("resolvePreviewUrl", () => {
  test("resolves Netlify template", () => {
    const url = resolvePreviewUrl(
      "https://{branch}--{siteId}.netlify.app",
      { branch: "draft", owner: "imazen", repo: "my-blog", siteId: "cool-site" },
    );
    expect(url).toBe("https://draft--cool-site.netlify.app");
  });

  test("resolves Vercel template", () => {
    const url = resolvePreviewUrl(
      "https://{repo}-git-{branch}-{owner}.vercel.app",
      { branch: "draft", owner: "imazen", repo: "my-blog" },
    );
    expect(url).toBe("https://my-blog-git-draft-imazen.vercel.app");
  });

  test("resolves Cloudflare Pages template", () => {
    const url = resolvePreviewUrl(
      "https://{branch}.{siteId}.pages.dev",
      { branch: "preview", owner: "x", repo: "site", siteId: "my-pages" },
    );
    expect(url).toBe("https://preview.my-pages.pages.dev");
  });

  test("falls back siteId to repo name", () => {
    const url = resolvePreviewUrl(
      "https://{branch}.{siteId}.pages.dev",
      { branch: "draft", owner: "x", repo: "my-site" },
    );
    expect(url).toBe("https://draft.my-site.pages.dev");
  });

  test("handles commit SHA", () => {
    const url = resolvePreviewUrl(
      "https://preview-{commitSha}.example.com",
      { branch: "main", owner: "x", repo: "y", commitSha: "abc123" },
    );
    expect(url).toBe("https://preview-abc123.example.com");
  });
});
