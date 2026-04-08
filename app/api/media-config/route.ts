import { NextResponse } from "next/server";
import { isExternalStorageConfigured, getMediaPublicUrl } from "@/lib/media/provider";

/**
 * GET /api/media-config
 *
 * Returns the media storage configuration for the client.
 * The client uses this to decide whether to upload via git or external storage,
 * and how to construct image URLs.
 */
export async function GET() {
  return NextResponse.json({
    storage: isExternalStorageConfigured() ? "external" : "git",
    publicUrl: getMediaPublicUrl(),
  });
}
