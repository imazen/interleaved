/**
 * Per-repo site configuration from .interleaved/config.json.
 *
 * This file lives in the user's repo and tells Interleaved how the site
 * is built, previewed, and deployed. All fields are optional with sensible
 * defaults — a repo with no config.json works out of the box.
 */

import { createOctokitInstance } from "@/lib/utils/octokit";

export type WorkflowMode = "direct" | "branch";
export type PreviewMode = "builtin" | "deploy" | "url" | "none";
export type GeneratorType = "handlebars" | "astro" | "hugo" | "eleventy" | "nextjs" | "nuxt" | "jekyll" | "other";

export type SiteConfig = {
  /** How edits are committed. "direct" = commit to default branch. "branch" = commit to draft branch, PR to merge. */
  workflow: WorkflowMode;
  /** Branch to commit directly to (workflow=direct) or merge target (workflow=branch). */
  defaultBranch: string;
  /** Branch for draft edits when workflow=branch. */
  draftBranch: string;
  /** Whether to auto-create PRs when publishing from draft branch. */
  autoCreatePr: boolean;

  /** Preview strategy. */
  preview: {
    mode: PreviewMode;
    /** URL template for deploy previews. Variables: {branch}, {owner}, {repo}, {commitSha} */
    urlTemplate?: string;
    /** How long to wait for a deploy preview to be ready (ms). */
    waitTimeout?: number;
  };

  /** Site generator — used for documentation hints in the admin UI. */
  generator: GeneratorType;

  /** URL prefix for media in templates (maps from storage path to output URL). */
  mediaOutput: string;

  /** Deploy platform for status checks. */
  deploy?: {
    platform?: "netlify" | "vercel" | "cloudflare-pages" | "github-pages" | "railway" | "other";
    /** Site ID or project name on the platform. */
    siteId?: string;
  };
};

const DEFAULTS: SiteConfig = {
  workflow: "direct",
  defaultBranch: "main",
  draftBranch: "draft",
  autoCreatePr: true,
  preview: {
    mode: "builtin",
    waitTimeout: 120000,
  },
  generator: "handlebars",
  mediaOutput: "/images",
};

/** Well-known preview URL templates per platform. */
const PLATFORM_PREVIEW_TEMPLATES: Record<string, string> = {
  "netlify": "https://{branch}--{siteId}.netlify.app",
  "vercel": "https://{repo}-git-{branch}-{owner}.vercel.app",
  "cloudflare-pages": "https://{branch}.{siteId}.pages.dev",
};

/**
 * Parse and validate a .interleaved/config.json object.
 * Unknown fields are ignored. Missing fields use defaults.
 */
export function parseSiteConfig(raw: Record<string, unknown>): SiteConfig {
  const config = { ...DEFAULTS };

  if (raw.workflow === "direct" || raw.workflow === "branch") {
    config.workflow = raw.workflow;
  }

  if (typeof raw.defaultBranch === "string") config.defaultBranch = raw.defaultBranch;
  if (typeof raw.draftBranch === "string") config.draftBranch = raw.draftBranch;
  if (typeof raw.autoCreatePr === "boolean") config.autoCreatePr = raw.autoCreatePr;

  if (raw.preview && typeof raw.preview === "object") {
    const p = raw.preview as Record<string, unknown>;
    if (p.mode === "builtin" || p.mode === "deploy" || p.mode === "url" || p.mode === "none") {
      config.preview = { ...config.preview, mode: p.mode };
    }
    if (typeof p.urlTemplate === "string") config.preview.urlTemplate = p.urlTemplate;
    if (typeof p.waitTimeout === "number") config.preview.waitTimeout = p.waitTimeout;
  }

  const generators = ["handlebars", "astro", "hugo", "eleventy", "nextjs", "nuxt", "jekyll", "other"];
  if (typeof raw.generator === "string" && generators.includes(raw.generator)) {
    config.generator = raw.generator as GeneratorType;
  }

  if (typeof raw.mediaOutput === "string") config.mediaOutput = raw.mediaOutput;

  if (raw.deploy && typeof raw.deploy === "object") {
    const d = raw.deploy as Record<string, unknown>;
    config.deploy = {};
    const platforms = ["netlify", "vercel", "cloudflare-pages", "github-pages", "railway", "other"];
    if (typeof d.platform === "string" && platforms.includes(d.platform)) {
      config.deploy.platform = d.platform as SiteConfig["deploy"] extends undefined ? never : NonNullable<SiteConfig["deploy"]>["platform"];
    }
    if (typeof d.siteId === "string") config.deploy.siteId = d.siteId;

    // Auto-set preview URL template from platform if not explicitly set
    if (!config.preview.urlTemplate && config.deploy.platform) {
      config.preview.urlTemplate = PLATFORM_PREVIEW_TEMPLATES[config.deploy.platform];
      if (config.preview.mode === "builtin" && config.generator !== "handlebars") {
        config.preview.mode = "deploy";
      }
    }
  }

  // Auto-detect: if generator isn't handlebars and no explicit preview mode, use deploy
  if (config.generator !== "handlebars" && config.preview.mode === "builtin") {
    config.preview.mode = config.preview.urlTemplate ? "deploy" : "none";
  }

  return config;
}

/**
 * Resolve preview URL template variables.
 */
export function resolvePreviewUrl(
  template: string,
  vars: { branch: string; owner: string; repo: string; commitSha?: string; siteId?: string },
): string {
  return template
    .replace(/\{branch\}/g, vars.branch)
    .replace(/\{owner\}/g, vars.owner)
    .replace(/\{repo\}/g, vars.repo)
    .replace(/\{commitSha\}/g, vars.commitSha || "")
    .replace(/\{siteId\}/g, vars.siteId || vars.repo);
}

/**
 * Auto-detect generator from repo files.
 */
export function detectGenerator(fileNames: string[]): GeneratorType {
  const names = new Set(fileNames.map(f => f.toLowerCase()));
  if (names.has("astro.config.mjs") || names.has("astro.config.ts")) return "astro";
  if (names.has("hugo.toml") || names.has("hugo.yaml") || names.has("config.toml")) return "hugo";
  if (names.has(".eleventy.js") || names.has("eleventy.config.js") || names.has("eleventy.config.mjs")) return "eleventy";
  if (names.has("next.config.js") || names.has("next.config.mjs") || names.has("next.config.ts")) return "nextjs";
  if (names.has("nuxt.config.ts") || names.has("nuxt.config.js")) return "nuxt";
  if (names.has("_config.yml") || names.has("gemfile")) return "jekyll";
  return "handlebars";
}

// Cache for loaded configs
const configCache = new Map<string, { config: SiteConfig; expiresAt: number }>();
const CONFIG_TTL_MS = 5 * 60 * 1000;

/**
 * Load the site config from .interleaved/config.json in the repo.
 * Falls back to defaults if the file doesn't exist.
 * Auto-detects generator from repo root files.
 */
export async function loadSiteConfig(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<SiteConfig> {
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}/${branch}`;
  const cached = configCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.config;

  const octokit = createOctokitInstance(token);
  let raw: Record<string, unknown> = {};

  // Try to load .interleaved/config.json
  try {
    const response = await octokit.rest.repos.getContent({
      owner, repo, path: ".interleaved/config.json", ref: branch,
    });
    if (!Array.isArray(response.data) && response.data.type === "file") {
      const content = Buffer.from(response.data.content, "base64").toString();
      raw = JSON.parse(content);
    }
  } catch {
    // No config file — use defaults
  }

  // Auto-detect generator if not specified
  if (!raw.generator) {
    try {
      const rootContents = await octokit.rest.repos.getContent({
        owner, repo, path: "", ref: branch,
      });
      if (Array.isArray(rootContents.data)) {
        raw.generator = detectGenerator(rootContents.data.map(f => f.name));
      }
    } catch {
      // Ignore
    }
  }

  const config = parseSiteConfig(raw);
  configCache.set(key, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
  return config;
}
