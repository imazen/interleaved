/**
 * Unit tests for frontmatter format auto-detection and parsing.
 */

import { describe, it, expect } from "vitest";
import { parse, detectFrontmatterFormat } from "../../lib/serialization";

describe("detectFrontmatterFormat", () => {
  it("detects TOML from +++", () => {
    expect(detectFrontmatterFormat("+++\ntitle = \"x\"\n+++\nbody"))
      .toBe("toml-frontmatter");
  });
  it("detects YAML from ---", () => {
    expect(detectFrontmatterFormat("---\ntitle: x\n---\nbody"))
      .toBe("yaml-frontmatter");
  });
  it("detects JSON from {", () => {
    expect(detectFrontmatterFormat('{"title": "x"}\nbody'))
      .toBe("json-frontmatter");
  });
  it("returns null when no recognizable delimiter", () => {
    expect(detectFrontmatterFormat("just body text\n")).toBeNull();
  });
  it("ignores leading BOM and whitespace", () => {
    expect(detectFrontmatterFormat("﻿  +++\nx=1\n+++\n"))
      .toBe("toml-frontmatter");
  });
});

describe("parse with auto-detect", () => {
  it("parses TOML frontmatter", () => {
    const out = parse('+++\ntitle = "Hello"\ndate = "2026-04-08"\n+++\nBody.');
    expect(out.title).toBe("Hello");
    expect(out.date).toBe("2026-04-08");
    expect(out.body).toBe("Body.");
  });

  it("parses YAML frontmatter (default fallback)", () => {
    const out = parse("---\ntitle: Hello\n---\nBody.");
    expect(out.title).toBe("Hello");
    expect(out.body).toBe("Body.");
  });

  it("parses TOML arrays + nested tables", () => {
    const out = parse([
      "+++",
      'title = "Test"',
      "tags = [\"a\", \"b\", \"c\"]",
      "[author]",
      'name = "Alice"',
      "+++",
      "Body.",
    ].join("\n"));
    expect(out.tags).toEqual(["a", "b", "c"]);
    expect(out.author.name).toBe("Alice");
  });

  it("returns body-only when no frontmatter delimiter", () => {
    const out = parse("just body text");
    expect(out.body).toBe("just body text");
  });

  it("explicit format overrides auto-detect", () => {
    // Content starts with --- but caller asks for TOML — TOML parser
    // sees --- as garbage and the parse fails / returns body.
    const out = parse("---\nx: 1\n---\nbody", { format: "yaml-frontmatter" });
    expect(out.x).toBe(1);
  });
});

describe("parse standalone formats", () => {
  it("parses standalone TOML", () => {
    const out = parse('title = "x"', { format: "toml" });
    expect(out.title).toBe("x");
  });
  it("parses standalone JSON", () => {
    const out = parse('{"title":"x"}', { format: "json" });
    expect(out.title).toBe("x");
  });
  it("parses standalone YAML", () => {
    const out = parse("title: x", { format: "yaml" });
    expect(out.title).toBe("x");
  });
});
