# Site built with Interleaved

This is a static site managed by [Interleaved](https://interleaved.app).
Content is edited by humans from their phones. Templates and styling are
edited by you (Claude).

## Your job

When the user asks you to work on this site:

1. **Read `.interleaved/claude.md`** for the full template reference
2. **Edit templates** in `templates/` — these are Handlebars HTML files
3. **Edit styles** inline in `templates/_head.html` or add CSS in `static/`
4. **Don't edit content** in `content/` unless specifically asked — that's
   the human's domain via the Interleaved admin
5. **Media references** use relative paths + RIAPI query strings:
   `images/hero.jpg?w=800&format=webp`

## Structure

```
templates/          Handlebars .html (edit these)
  base.html         Default layout
  post.html         Blog post layout
  index.html        Collection index
  _header.html      Partial ({{> header}})
  _footer.html      Partial ({{> footer}})
content/            Markdown + YAML frontmatter (human-edited)
data/               JSON data files (editable by both)
  site.json         Site name, nav, description
static/             Static assets (CSS, JS, fonts)
.interleaved/       CMS configuration
  config.json       Workflow, preview, generator settings
  claude.md         Detailed reference for you
```

## Quick commands

Build: `npx tsx scripts/build-site.ts --src . --out ./_site`

Preview locally: `npx serve _site`

## Key rules

- Templates are plain HTML with `{{handlebars}}` tags
- `{{{content}}}` = rendered markdown body (triple braces = unescaped)
- `{{> partialName}}` includes a partial (file prefixed with `_`)
- `data/site.json` fields available as `{{site.name}}`, `{{site.nav}}`, etc.
- Frontmatter fields available as `{{title}}`, `{{date}}`, etc.
