/**
 * Unit tests for the website filter library.
 *
 * Each filter is tested as a pure data transform — no engine state, no I/O.
 * This file is the conformance suite a future Rust+WASM port would mirror.
 */

import { describe, it, expect } from "vitest";
import {
  eq, ne, gt, gte, lt, lte,
  and, or, not,
  lowercase, uppercase, capitalize,
  slugify, truncate, excerpt, replace,
  markdownify, markdownifyInline, striphtml,
  length, first, last, reverse,
  limit, offset, unique, where, sortBy, groupBy,
  formatDate, dateIso, year,
  absoluteUrl, urlencode, relUrl,
  add, subtract, multiply, divide, mod, min, max,
} from "../../lib/renderer/filters";

describe("comparison filters", () => {
  it("eq: strict equality", () => {
    expect(eq(1, 1)).toBe(true);
    expect(eq(1, "1")).toBe(false);
    expect(eq(null, undefined)).toBe(false);
  });
  it("ne", () => {
    expect(ne(1, 2)).toBe(true);
    expect(ne(1, 1)).toBe(false);
  });
  it("gt / gte / lt / lte", () => {
    expect(gt(2, 1)).toBe(true);
    expect(gt(1, 1)).toBe(false);
    expect(gte(1, 1)).toBe(true);
    expect(lt(1, 2)).toBe(true);
    expect(lte(1, 1)).toBe(true);
  });
});

describe("logic filters", () => {
  it("and / or / not", () => {
    expect(and(1, 2)).toBe(true);
    expect(and(0, 1)).toBe(false);
    expect(or(0, 1)).toBe(true);
    expect(or(0, 0)).toBe(false);
    expect(not(0)).toBe(true);
    expect(not("x")).toBe(false);
  });
});

describe("string filters", () => {
  it("lowercase / uppercase / capitalize", () => {
    expect(lowercase("Hello")).toBe("hello");
    expect(uppercase("hello")).toBe("HELLO");
    expect(capitalize("hello")).toBe("Hello");
    expect(capitalize("")).toBe("");
  });

  it("slugify: handles diacritics + symbols + edge whitespace", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Multiple   spaces  ")).toBe("multiple-spaces");
    expect(slugify("Café résumé")).toBe("cafe-resume");
    expect(slugify("foo & bar / baz")).toBe("foo-bar-baz");
  });

  it("truncate: keeps short strings, trims long ones", () => {
    expect(truncate("short", 10)).toBe("short");
    expect(truncate("this is too long", 7)).toBe("this is…");
    expect(truncate("custom", 3, "...")).toBe("cus...");
  });

  it("excerpt: word-aware truncation", () => {
    expect(excerpt("one two three four five", 3)).toBe("one two three…");
    expect(excerpt("only two", 5)).toBe("only two");
  });

  it("replace: replaces all occurrences", () => {
    expect(replace("a-b-c", "-", "_")).toBe("a_b_c");
    expect(replace("aaa", "a", "")).toBe("");
  });

  it("markdownify: block-level rendering", () => {
    const out = markdownify("# Hello\n\nWorld") as string;
    expect(out).toContain("<h1>Hello</h1>");
    expect(out).toContain("<p>World</p>");
  });

  it("markdownifyInline: no block wrapping", () => {
    const out = markdownifyInline("**bold** _italic_") as string;
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).not.toMatch(/^<p>/);
  });

  it("striphtml: removes all tags", () => {
    expect(striphtml("<p>hi <b>there</b></p>")).toBe("hi there");
  });
});

describe("array filters", () => {
  it("length: arrays, strings, objects", () => {
    expect(length([1, 2, 3])).toBe(3);
    expect(length("abc")).toBe(3);
    expect(length({ a: 1, b: 2 })).toBe(2);
    expect(length(null)).toBe(0);
  });

  it("first / last / reverse (non-mutating)", () => {
    expect(first([1, 2, 3])).toBe(1);
    expect(last([1, 2, 3])).toBe(3);
    const arr = [1, 2, 3];
    expect(reverse(arr)).toEqual([3, 2, 1]);
    expect(arr).toEqual([1, 2, 3]); // original unchanged
  });

  it("limit / offset", () => {
    expect(limit([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(offset([1, 2, 3, 4], 2)).toEqual([3, 4]);
  });

  it("unique: dedupes by strict equality", () => {
    expect(unique([1, 2, 1, 3, 2])).toEqual([1, 2, 3]);
  });

  it("where: filters by key=value, or by key truthy when no value", () => {
    const items = [
      { name: "a", draft: true },
      { name: "b", draft: false },
      { name: "c" },
    ];
    expect(where(items, "draft", false)).toEqual([{ name: "b", draft: false }]);
    expect(where(items, "draft")).toEqual([{ name: "a", draft: true }]);
  });

  it("sortBy: ascending default, desc supported, stable on null", () => {
    const items = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect(sortBy(items, "n")).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(sortBy(items, "n", "desc")).toEqual([{ n: 3 }, { n: 2 }, { n: 1 }]);
    // null keys go to the end on asc, beginning on desc
    const withNull = [{ n: 1 }, { n: null }, { n: 2 }];
    expect((sortBy(withNull, "n") as { n: number | null }[])[2].n).toBe(null);
  });

  it("groupBy: returns {key, items} sorted by key", () => {
    const items = [
      { cat: "a", id: 1 },
      { cat: "b", id: 2 },
      { cat: "a", id: 3 },
    ];
    const groups = groupBy(items, "cat") as { key: string; items: unknown[] }[];
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe("a");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].key).toBe("b");
  });
});

describe("date filters", () => {
  it("formatDate: long English date, falsy passthrough", () => {
    const out = formatDate("2026-04-08") as string;
    expect(out).toMatch(/April/);
    expect(out).toMatch(/2026/);
    expect(formatDate(null)).toBe("");
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });

  it("dateIso: returns ISO 8601 or empty", () => {
    expect(dateIso("2026-04-08")).toMatch(/^2026-04-08T/);
    expect(dateIso(null)).toBe("");
  });

  it("year: 4-digit UTC year", () => {
    expect(year("2026-04-08")).toBe(2026);
    expect(year(null)).toBe("");
  });
});

describe("url filters", () => {
  it("absoluteUrl: prepends base, leaves https alone", () => {
    expect(absoluteUrl("/about", "https://x.com")).toBe("https://x.com/about");
    expect(absoluteUrl("about", "https://x.com")).toBe("https://x.com/about");
    expect(absoluteUrl("https://other.com", "https://x.com")).toBe("https://other.com");
    expect(absoluteUrl("/about", "https://x.com/")).toBe("https://x.com/about");
  });

  it("urlencode", () => {
    expect(urlencode("hello world")).toBe("hello%20world");
    expect(urlencode("a&b=c")).toBe("a%26b%3Dc");
  });

  it("relUrl: strips leading slash", () => {
    expect(relUrl("/foo/bar")).toBe("foo/bar");
    expect(relUrl("foo/bar")).toBe("foo/bar");
  });
});

describe("math filters", () => {
  it("add / subtract / multiply / divide / mod", () => {
    expect(add(2, 3)).toBe(5);
    expect(subtract(5, 3)).toBe(2);
    expect(multiply(4, 3)).toBe(12);
    expect(divide(10, 4)).toBe(2.5);
    expect(divide(10, 0)).toBe(0); // safe
    expect(mod(10, 3)).toBe(1);
    expect(mod(10, 0)).toBe(0);
  });

  it("min / max", () => {
    expect(min(3, 5)).toBe(3);
    expect(max(3, 5)).toBe(5);
  });
});
