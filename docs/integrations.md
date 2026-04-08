# Integrating Interleaved with Your Site

Interleaved edits files in your GitHub repo. Your site generator reads those
files and builds HTML. This guide covers how to connect the two.

## How It Works

```
You edit in Interleaved → commit to GitHub → build triggers → site updates
```

Interleaved doesn't build your site. It edits markdown, JSON, and media
in your repo. Your existing build pipeline (Netlify, Vercel, Cloudflare
Pages, GitHub Actions) handles the rest.

## Quick Setup (Any Generator)

1. Install the [Interleaved GitHub App](https://github.com/apps/interleaved-cms)
   on your repo
2. Go to [interleaved.app](https://interleaved.app) and open your repo
3. Start editing — Interleaved auto-detects your content structure

Optionally add `.interleaved/config.json` for custom behavior (see below).

---

## Generator-Specific Guides

### Astro

Astro's content collections work directly with Interleaved's auto-detection.

**Typical structure:**
```
src/content/
  blog/
    hello-world.md
    another-post.md
  config.ts          ← Astro content config (Interleaved doesn't touch this)
data/
  site.json
public/
  images/            ← theme images (in git)
```

**`.interleaved/config.json`:**
```json
{
  "generator": "astro",
  "preview": {
    "mode": "deploy",
    "urlTemplate": "https://{branch}.{siteId}.pages.dev"
  },
  "deploy": {
    "platform": "cloudflare-pages",
    "siteId": "my-astro-site"
  },
  "mediaOutput": "/images"
}
```

**Notes:**
- Astro validates frontmatter at build time via Zod schemas. If you add
  fields in Interleaved that aren't in your Astro schema, the build fails.
  Keep your Astro content config in sync.
- Astro's `public/` directory maps to the site root. Media URLs like
  `/images/hero.jpg` resolve correctly.

### Hugo

**Typical structure:**
```
content/
  posts/
    hello-world.md
  about.md
data/
  site.json
static/
  images/
layouts/
  _default/
    baseof.html
    single.html
    list.html
```

**`.interleaved/config.json`:**
```json
{
  "generator": "hugo",
  "preview": {
    "mode": "deploy",
    "urlTemplate": "https://deploy-preview-{branch}--{siteId}.netlify.app"
  },
  "deploy": {
    "platform": "netlify",
    "siteId": "my-hugo-site"
  },
  "mediaOutput": "/images"
}
```

**Notes:**
- Hugo uses `content/` by default. Interleaved auto-detects this.
- Hugo's `data/` directory is auto-detected for JSON data files.
- Hugo front matter supports TOML (`+++`), YAML (`---`), and JSON.
  Interleaved defaults to YAML frontmatter.

### Eleventy (11ty)

**Typical structure:**
```
src/
  posts/
    hello-world.md
  _data/
    site.json
  _includes/
    base.njk
```

**`.interleaved/config.json`:**
```json
{
  "generator": "eleventy",
  "preview": {
    "mode": "deploy",
    "urlTemplate": "https://{branch}--{siteId}.netlify.app"
  },
  "deploy": {
    "platform": "netlify",
    "siteId": "my-11ty-site"
  }
}
```

### Next.js

**Typical structure:**
```
content/
  posts/
    hello-world.md
  pages/
    about.md
public/
  images/
```

**`.interleaved/config.json`:**
```json
{
  "generator": "nextjs",
  "preview": {
    "mode": "deploy",
    "urlTemplate": "https://{repo}-git-{branch}-{owner}.vercel.app"
  },
  "deploy": {
    "platform": "vercel"
  }
}
```

### Built-in Handlebars (No Framework)

Use Interleaved's built-in renderer for simple sites with no build tooling.

**Structure:**
```
templates/
  base.html
  post.html
  index.html
  _header.html
  _footer.html
content/
  posts/
    hello-world.md
  about.md
data/
  site.json
static/
  style.css
```

**`.interleaved/config.json`:**
```json
{
  "generator": "handlebars",
  "preview": {
    "mode": "builtin"
  }
}
```

Build with: `npx tsx scripts/build-site.ts --src . --out ./_site`

Preview is instant — renders through the admin server, no external build needed.

---

## Deploy Platform Guides

### Netlify

1. Connect your GitHub repo to Netlify
2. Netlify auto-deploys on every push to `main`
3. Branch deploys give you preview URLs for the `draft` branch

**Preview URL template:** `https://{branch}--{siteId}.netlify.app`

The `siteId` is your Netlify site's subdomain (from the dashboard URL).

### Vercel

1. Import your GitHub repo in Vercel
2. Vercel auto-deploys on push and creates preview deployments for branches

**Preview URL template:** `https://{repo}-git-{branch}-{owner}.vercel.app`

### Cloudflare Pages

1. Create a Pages project connected to your GitHub repo
2. CF Pages auto-deploys main and creates branch previews

**Preview URL template:** `https://{branch}.{siteId}.pages.dev`

The `siteId` is your Pages project name.

### GitHub Pages

GitHub Pages doesn't support branch previews natively. Use workflow=direct
(the default) and preview via the built-in renderer.

---

## Workflow Modes

### Direct (Default)

Every edit commits directly to the default branch. The site rebuilds
immediately. Best for personal sites, blogs, and small teams.

```json
{ "workflow": "direct" }
```

### Branch

Edits go to a `draft` branch. Click "Publish" to create a PR or merge.
Deploy platforms auto-create preview URLs for the draft branch.

```json
{
  "workflow": "branch",
  "draftBranch": "draft",
  "autoCreatePr": true
}
```

The Publish button appears in the admin when there are unpublished changes
on the draft branch.

---

## Media

User-uploaded media goes to external blob storage (Cloudflare R2 by default),
not to git. Each repo gets an isolated namespace.

In content files, reference media with relative paths:
```markdown
image: images/hero.jpg
```

In templates, use RIAPI query strings for responsive images:
```html
<img src="{{image}}?w=800&format=webp" alt="{{title}}">
```

Theme assets (logos, icons, CSS backgrounds) can stay in git under `static/`
or `public/`.
