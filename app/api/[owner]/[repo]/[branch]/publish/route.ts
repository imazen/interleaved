import { type NextRequest } from "next/server";
import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { loadSiteConfig } from "@/lib/site-config";
import { createPublishPr, mergeDraftToDefault, hasUnpublishedChanges } from "@/lib/branch-workflow";
import { createHttpError, toErrorResponse } from "@/lib/api-error";

/**
 * Publish content from draft branch to default branch.
 *
 * POST /api/[owner]/[repo]/[branch]/publish
 *   { action: "pr" }     → create/return PR
 *   { action: "merge" }  → direct merge
 *
 * GET /api/[owner]/[repo]/[branch]/publish
 *   → returns unpublished change count
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

    const config = await loadSiteConfig(params.owner, params.repo, params.branch, token);

    if (config.workflow !== "branch") {
      throw createHttpError("Publish is only available with branch workflow. Set workflow: branch in .interleaved/config.json.", 400);
    }

    const data = await request.json();
    const action = data.action;

    if (action === "pr") {
      const result = await createPublishPr(token, params.owner, params.repo, config, data.title);
      return Response.json({
        status: "success",
        data: result,
      });
    }

    if (action === "merge") {
      await mergeDraftToDefault(token, params.owner, params.repo, config);
      return Response.json({
        status: "success",
        message: "Draft merged to " + config.defaultBranch,
      });
    }

    throw createHttpError("action must be 'pr' or 'merge'", 400);
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; branch: string }> },
) {
  try {
    const params = await context.params;
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const user = sessionResult.user;
    const { token } = await getToken(user, params.owner, params.repo);
    if (!token) throw createHttpError("Token not found", 401);

    const config = await loadSiteConfig(params.owner, params.repo, params.branch, token);

    if (config.workflow !== "branch") {
      return Response.json({ status: "success", data: { workflow: "direct" } });
    }

    const changes = await hasUnpublishedChanges(token, params.owner, params.repo, config);

    return Response.json({
      status: "success",
      data: {
        workflow: "branch",
        draftBranch: config.draftBranch,
        defaultBranch: config.defaultBranch,
        ...changes,
      },
    });
  } catch (error: any) {
    console.error(error);
    return toErrorResponse(error);
  }
}
