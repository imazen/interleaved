import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/client-error
 *
 * Logs client-side errors to the server console (and Sentry if configured).
 * Fire-and-forget from the error boundary — no auth required.
 */
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    const { message, stack, digest, url, userAgent } = data;

    console.error(
      `[CLIENT ERROR] ${message}\n` +
      `  URL: ${url || "unknown"}\n` +
      `  Digest: ${digest || "none"}\n` +
      `  UA: ${userAgent || "unknown"}\n` +
      `  Stack:\n${stack || "no stack trace"}`,
    );

    // Forward to Sentry server-side if available
    try {
      const Sentry = await import("@sentry/nextjs");
      if (Sentry.captureException) {
        const err = new Error(message);
        err.stack = stack;
        Sentry.captureException(err, {
          tags: { source: "client-error-boundary" },
          extra: { url, userAgent, digest },
        });
      }
    } catch { /* Sentry not configured */ }

    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "ok" });
  }
}
