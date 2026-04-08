# Interleaved Site — Instructions for Code Agents

This site is managed by [Interleaved](https://interleaved.app), a CMS for
static sites. Humans edit content from their phones. You handle templates,
styling, and code. Here's how things are structured.

## Content

Content lives in `content/` as markdown files with YAML frontmatter:

```markdown
---
title: My Post
date: 2026-04-07
description: A short summary
image: images/hero.jpg
tags: [design, tutorial]
layout: post
---

Body text in **markdown**.
```

- The `layout` field selects which template renders this content.
  If omitted, defaults to `post` for files in collection directories, `base` otherwise.
- Frontmatter fields are available as `{{variables}}` in templates.
- The rendered markdown body is available as `{{{content}}}` (triple braces = unescaped HTML).

### JSON data files

Global data lives in `data/` as JSON files. Each file's name becomes a
template variable: `data/site.json` → `{{site.name}}`, `{{site.nav}}`.

## Content-to-URL mapping (for preview)

Every content file maps to a URL on the built site. The preview system
uses these mappings to render the correct page when editing a file.

**Resolution order (first match wins):**

1. **Frontmatter `url:` field** — explicit URL for this page.
   ```yaml
   ---
   title: About
   url: /about.html
   ---
   ```

2. **Frontmatter `_preview:` field** — for files that don't have their
   own URL (data files, partials), specifies which page to render as
   a preview. Takes a URL or a path to a content file.
   ```json
   {
     "_preview": "/",
     "siteName": "My Blog",
     "nav": [...]
   }
   ```

3. **Path-based defaults:**
   - `content/index.md` → `/`
   - `content/about.md` → `/about.html`
   - `content/posts/hello.md` → `/posts/hello.html`
   - `content/posts/2026-04-01-hello.md` → `/posts/hello.html` (date stripped)
   - `data/*.json` → `/` (index page, since data affects every page)
   - `templates/post.html` → renders a sample post if one is configured

4. **`.interleaved/mapping.json` overrides** — for files that don't
   follow conventions. Format:
   ```json
   {
     "routes": {
       "data/navigation.json": "/",
       "data/products/item-1.json": "/products/item-1.html"
     },
     "templateSamples": {
       "templates/post.html": "content/posts/hello-world.md",
       "templates/index.html": null
     }
   }
   ```
   - `routes`: maps a content file path to its URL. Supports `*` globs:
     `"data/products/*.json": "/products/{name}.html"` where `{name}`
     is the file's basename without extension.
   - `templateSamples`: when editing a template, which content file to
     render with it. `null` = render the site index.

**When editing a template or data file**, preview always shows a real
page (not raw JSON/HTML). The preview worker uses the mapping to pick
the right URL.

## Templates

Templates are Handlebars `.html` files in `templates/`:

```
templates/
  base.html       ← default layout
  post.html       ← blog post layout
  index.html      ← collection index (lists posts)
  _header.html    ← partial (prefix _ = partial, use {{> header}})
  _footer.html    ← partial
```

### Template syntax

```handlebars
{{title}}                          ← escaped variable
{{{content}}}                      ← unescaped HTML (rendered markdown)
{{> header}}                       ← include partial
{{#if draft}}...{{/if}}            ← conditional
{{#each posts}}...{{/each}}        ← loop
{{formatDate date}}                ← format date as "April 7, 2026"
{{truncate description 120}}       ← truncate text
{{#each (sortBy posts "date" "desc")}}  ← sort array
```

Templates are plain HTML — add any CSS framework, scripts, or meta tags directly.

## Media

Media is stored externally (not in git). Reference images with relative paths
in content files:

```markdown
image: images/hero.jpg
```

The admin resolves these to the media CDN URL automatically.

### Image transforms (RIAPI)

The media URL supports query-string image transforms. Use these in templates
for responsive images:

```html
<!-- Resize -->
<img src="{{image}}?w=800" alt="{{title}}">

<!-- Resize + format conversion -->
<img src="{{image}}?w=400&format=webp" alt="{{title}}">

<!-- Crop to exact dimensions -->
<img src="{{image}}?w=300&h=300&mode=crop" alt="{{title}}">

<!-- Responsive srcset -->
<img
  srcset="{{image}}?w=400&format=webp 400w,
          {{image}}?w=800&format=webp 800w,
          {{image}}?w=1200&format=webp 1200w"
  sizes="(max-width: 600px) 400px, (max-width: 1000px) 800px, 1200px"
  src="{{image}}?w=800&format=webp"
  alt="{{title}}"
>
```

Available transform parameters:
- `w` / `width` — target width in pixels
- `h` / `height` — target height in pixels
- `mode` — `max` (fit within), `crop` (fill + crop), `pad` (fit + pad), `stretch`
- `format` — `webp`, `avif`, `jpeg`, `png`, `gif`
- `quality` — 1-100 (default 90 for JPEG)
- `anchor` — crop anchor: `topleft`, `topcenter`, `topright`, `middlecenter`, etc.
- `bgcolor` — padding color for mode=pad (hex or named)
- `f.sharpen` — 0-99
- `rotate` — 90, 180, 270
- `dpr` — device pixel ratio multiplier

Full reference: https://docs.imageflow.io/querystring/introduction.html

### Querying available media

If you have access to the Interleaved MCP server, use these tools:
- `list_media` — browse uploaded media files
- `get_media_url` — get a media URL with optional transforms
- `get_content_schema` — understand the frontmatter structure

## Building

```bash
npx tsx scripts/build-site.ts --src . --out ./_site
```

This reads `content/`, `templates/`, `data/`, and outputs static HTML to `_site/`.

## Conventions

- One markdown file = one page
- Filename becomes the URL slug: `hello-world.md` → `/hello-world.html`
- Files in `content/posts/` are blog posts, listed by `index.html`
- Files in `static/` are copied as-is (CSS, JS, fonts, etc.)
- Don't put user media in git — it goes to external storage via the admin
- Template/theme images (logos, icons) can live in `static/` in git
