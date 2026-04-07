/**
 * Git-backed media storage provider.
 *
 * Stores media files directly in the GitHub repository via the Contents API.
 * This is the default behavior inherited from PagesCMS — suitable for theme
 * assets, small sites, and repos that prefer everything in git.
 */

import { createOctokitInstance } from "@/lib/utils/octokit";
import { getFileExtension } from "@/lib/utils/file";
import type { MediaStorageProvider, MediaFile, UploadResult, GitStorageConfig } from "./types";

export class GitMediaProvider implements MediaStorageProvider {
  readonly type = "git" as const;

  private owner: string;
  private repo: string;
  private branch: string;
  private token: string;

  constructor(config: GitStorageConfig) {
    this.owner = config.owner;
    this.repo = config.repo;
    this.branch = config.branch;
    this.token = config.token;
  }

  async listFiles(path: string): Promise<MediaFile[]> {
    const octokit = createOctokitInstance(this.token);
    const response = await octokit.rest.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path: path || "",
      ref: this.branch,
    });

    if (!Array.isArray(response.data)) {
      throw new Error(`Expected directory but got ${response.data.type}`);
    }

    return response.data.map((item: any) => ({
      name: item.name,
      path: item.path,
      type: item.type === "dir" ? "dir" : "file",
      size: item.size,
      sha: item.sha,
      url: item.download_url,
    }));
  }

  async uploadFile(
    path: string,
    contentBase64: string,
    options?: { sha?: string },
  ): Promise<UploadResult> {
    const octokit = createOctokitInstance(this.token);
    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner: this.owner,
      repo: this.repo,
      path,
      message: `Upload ${path} (via Interleaved)`,
      content: contentBase64,
      branch: this.branch,
      sha: options?.sha || undefined,
    });

    const content = response.data.content;
    return {
      path: content?.path || path,
      name: content?.name || path.split("/").pop() || "",
      sha: content?.sha,
      size: content?.size,
      url: content?.download_url || undefined,
      extension: getFileExtension(content?.name || path),
    };
  }

  getUrl(path: string): string {
    return `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${encodeURIComponent(this.branch)}/${encodeURI(path)}`;
  }

  async deleteFile(path: string, sha?: string): Promise<void> {
    if (!sha) {
      // Need to fetch the SHA first
      const octokit = createOctokitInstance(this.token);
      const response = await octokit.rest.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: this.branch,
      });
      if (Array.isArray(response.data)) throw new Error("Expected file, got directory");
      sha = response.data.sha;
    }

    const octokit = createOctokitInstance(this.token);
    await octokit.rest.repos.deleteFile({
      owner: this.owner,
      repo: this.repo,
      path,
      message: `Delete ${path} (via Interleaved)`,
      sha,
      branch: this.branch,
    });
  }
}
