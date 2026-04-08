# My Site

Built with [Interleaved](https://interleaved.app) — edit content from your phone, let Claude handle the code.

## Get started

### 1. Edit content

Go to [interleaved.app](https://interleaved.app), sign in with GitHub, and open this repo. Edit posts, pages, and media from any device.

### 2. Customize with Claude

Open this repo in Claude Code to redesign templates, add pages, or change styling:

[![Open in Claude Code](https://img.shields.io/badge/Open%20in-Claude%20Code-7C3AED?style=flat-square)](https://claude.ai/code?repo=OWNER/REPO)

Ask Claude to:
- "Redesign the homepage with a different layout"
- "Add a portfolio page with a grid of project cards"
- "Change the color scheme to dark blue"
- "Add an RSS feed"

Claude reads `CLAUDE.md` and `.interleaved/claude.md` to understand the site structure.

### 3. Deploy

Every push to `main` triggers a build. The included GitHub Actions workflow builds the site and deploys to GitHub Pages.

For other platforms:
- **Cloudflare Pages**: connect this repo, build command: `npx tsx scripts/build-site.ts --src . --out ./_site`, output dir: `_site`
- **Netlify**: same build command and output dir
- **Vercel**: same build command and output dir

### Custom domain

Configure your domain on your hosting platform, then update `data/site.json` with your URL.

## Structure

```
content/posts/     Blog posts (markdown)
content/           Standalone pages (markdown)
data/site.json     Site name, nav, description
templates/         HTML templates (Handlebars)
static/            CSS, JS, fonts, theme images
```

## License

Content is yours. The template is MIT licensed via [Interleaved](https://github.com/imazen/interleaved).
