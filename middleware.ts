import { NextResponse, type NextRequest } from "next/server";

/**
 * Middleware: canonical domain redirect + API rate limiting.
 *
 * 1. Redirects non-canonical admin domains to ADMIN_CANONICAL_HOST
 *    (e.g., interleaved.app → admin.interleaved.app).
 *    Both domains work for access, but one is canonical.
 *    Set ADMIN_CANONICAL_HOST to enable. Unset = no redirect.
 *    ADMIN_ALLOWED_HOSTS is a comma-separated list of hosts that
 *    should serve the app (not redirect). All others 404.
 *
 * 2. Rate limits API routes — sliding window per IP.
 */

const CANONICAL_HOST = process.env.ADMIN_CANONICAL_HOST?.trim() || "";
const ALLOWED_HOSTS = new Set(
  (process.env.ADMIN_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
// Always allow the canonical host
if (CANONICAL_HOST) ALLOWED_HOSTS.add(CANONICAL_HOST.toLowerCase());

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || "120", 10);

type RateEntry = { count: number; resetAt: number };
const store = new Map<string, RateEntry>();

// Periodic cleanup to prevent memory leak
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function middleware(request: NextRequest) {
  // --- Canonical domain redirect ---
  if (CANONICAL_HOST && ALLOWED_HOSTS.size > 0) {
    const host = request.headers.get("host")?.split(":")[0]?.toLowerCase() || "";
    if (host && !ALLOWED_HOSTS.has(host) && host !== "localhost") {
      // Unknown host — redirect to canonical
      const url = request.nextUrl.clone();
      url.host = CANONICAL_HOST;
      url.port = "";
      url.protocol = "https:";
      return NextResponse.redirect(url, 301);
    }
    if (host && host !== CANONICAL_HOST.toLowerCase() && host !== "localhost") {
      // Allowed but non-canonical — redirect to canonical
      const url = request.nextUrl.clone();
      url.host = CANONICAL_HOST;
      url.port = "";
      url.protocol = "https:";
      return NextResponse.redirect(url, 301);
    }
  }

  // --- Rate limiting (API routes only) ---
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Skip rate limiting for webhooks (GitHub sends bursts)
  if (request.nextUrl.pathname.startsWith("/api/webhook/")) {
    return NextResponse.next();
  }

  cleanup();

  const ip = getClientIp(request);
  const now = Date.now();
  let entry = store.get(ip);

  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }

  entry.count++;

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(MAX_REQUESTS));
  response.headers.set("X-RateLimit-Remaining", String(Math.max(0, MAX_REQUESTS - entry.count)));
  response.headers.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

  if (entry.count > MAX_REQUESTS) {
    return new NextResponse(
      JSON.stringify({ status: "error", message: "Too many requests. Please try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)),
          "X-RateLimit-Limit": String(MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil(entry.resetAt / 1000)),
        },
      },
    );
  }

  return response;
}

export const config = {
  matcher: [
    // Run on all routes for domain redirect, but skip static assets
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|images/).*)",
  ],
};
