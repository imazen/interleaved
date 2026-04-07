# Interleaved

A Claude-native CMS for static sites. Fork of [Pages CMS](https://github.com/pagescms/pagescms).

Human edits content on their phone. Claude revises templates and styling. Both work on the same git repo, interleaved.

## What's Different from Pages CMS

- **Schema inference** — drop markdown files in a folder, start editing. No `.pages.yml` required (still supported as opt-in override)
- **External media storage** — user uploads go to R2/S3/local with [RIAPI/Imageflow](https://github.com/imazen/imageflow) query-string transforms. Theme assets stay in git
- **Mobile-first UI** — fixed bottom toolbar (avoids OS selection bubble), card-based content list, camera-to-upload pipeline
- **Claude Code friendly** — all content is plain markdown + YAML frontmatter. Zero proprietary formats. MCP server for media library access
- **First-class source editing** — CodeMirror is a peer of the rich text editor, not hidden behind a toggle

## What's the Same

- GitHub App model for repo access
- PostgreSQL + Drizzle ORM (deploy on Railway, etc.)
- Next.js + React + shadcn/ui + TipTap + CodeMirror
- MIT license

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL
- A GitHub App

### Quick Start

```bash
git clone https://github.com/lilith/interleaved.git
cd interleaved
npm install
```

Start PostgreSQL:

```bash
docker run --name interleaved-db -e POSTGRES_USER=interleaved -e POSTGRES_PASSWORD=interleaved -e POSTGRES_DB=interleaved -p 5432:5432 -d postgres:16
```

Create `.env.local`:

```bash
DATABASE_URL=postgresql://interleaved:interleaved@localhost:5432/interleaved
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
CRYPTO_KEY=$(openssl rand -base64 32)
```

Create GitHub App:

```bash
npm run setup:github-app -- --base-url http://localhost:3000
```

Run migrations and start:

```bash
npm run db:migrate
npm run dev
```

## Architecture

```
Interleaved Admin (this app)     Static Site (any host)
        │                               │
        │ GitHub API                     │ git clone + build
        ▼                               ▼
   ┌──────────────────────────────────────┐
   │           Git Repo                    │
   │  content/*.md  templates/  styles/    │
   └──────────────────────────────────────┘
        │                               │
        │ RIAPI URLs                    │ RIAPI URLs
        ▼                               ▼
   ┌──────────────────────────────────────┐
   │  Media Storage (R2/S3/local)          │
   │  + Imageflow Server (transforms)      │
   └──────────────────────────────────────┘
```

The admin app and the static site are separate deployments sharing a git repo and media store.

## License

MIT. See [LICENSE](LICENSE) for details.

Based on [Pages CMS](https://github.com/pagescms/pagescms) by Ronan Berder.
