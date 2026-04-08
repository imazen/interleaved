import { type NextRequest } from "next/server";
import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { createHttpError, toErrorResponse } from "@/lib/api-error";
import { createMediaProvider, isExternalStorageConfigured } from "@/lib/media/provider";
import { getRepoId } from "@/lib/github-repo-id";

/**
 * Upload media to external storage (S3/R2) or get a presigned upload URL.
 *
 * POST /api/[owner]/[repo]/[branch]/media-upload
 *
 * Body:
 *   { path: string, content: string (base64), contentType?: string }
 *
 * Or for presigned URL (when ?presign=true):
 *   { path: string, contentType: string }
 *
 * Returns:
 *   { status: "success", data: { path, url, ... } }
 *
 * Only active when MEDIA_S3_BUCKET is configured. Otherwise returns 404.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const user = sessionResult.user;
    const { token } = await getToken(user, params.owner, params.repo, true);
    if (!token) throw createHttpError("Token not found", 401);

    if (!isExternalStorageConfigured()) {
      throw createHttpError(
        "External media storage is not configured. Set MEDIA_S3_BUCKET environment variable.",
        404,
      );
    }

    const repoId = await getRepoId(token, params.owner, params.repo);
    const provider = createMediaProvider(repoId);
    const data = await request.json();
    const { searchParams } = new URL(request.url);
    const presign = searchParams.get("presign") === "true";

    if (presign) {
      // Return a presigned upload URL for direct client-to-storage upload
      if (!data.path || !data.contentType) {
        throw createHttpError("path and contentType are required for presigned uploads", 400);
      }

      if (!provider.getPresignedUploadUrl) {
        throw createHttpError("This storage provider does not support presigned uploads", 400);
      }

      const result = await provider.getPresignedUploadUrl(data.path, data.contentType);
      if (!result) {
        throw createHttpError("Failed to generate presigned URL", 500);
      }

      return Response.json({
        status: "success",
        data: result,
      });
    }

    // Server-side upload
    if (!data.path || !data.content) {
      throw createHttpError("path and content (base64) are required", 400);
    }

    // 50 MB base64 limit (~37.5 MB raw)
    const MAX_CONTENT_LENGTH = 50 * 1024 * 1024;
    if (typeof data.content !== "string" || data.content.length > MAX_CONTENT_LENGTH) {
      throw createHttpError("File content exceeds the 50 MB upload limit", 413);
    }

    const result = await provider.uploadFile(data.path, data.content, {
      contentType: data.contentType,
    });

    return Response.json({
      status: "success",
      data: result,
    });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}

/**
 * List media from external storage.
 *
 * GET /api/[owner]/[repo]/[branch]/media-upload?path=images
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const user = sessionResult.user;
    const { token } = await getToken(user, params.owner, params.repo);
    if (!token) throw createHttpError("Token not found", 401);

    if (!isExternalStorageConfigured()) {
      throw createHttpError("External media storage is not configured", 404);
    }

    const repoId = await getRepoId(token, params.owner, params.repo);
    const provider = createMediaProvider(repoId);
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path") || "";

    const files = await provider.listFiles(path);

    return Response.json({
      status: "success",
      data: files.map((f) => ({
        type: f.type,
        name: f.name,
        path: f.path,
        size: f.size,
        url: f.url,
      })),
    });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}
