import { NextResponse, type NextRequest } from "next/server";

/**
 * Unified middleware: CSRF protection, canonical domain redirect, rate limiting.
 *
 * Replaces the separate proxy.ts (which Next.js 16 doesn't allow alongside middleware.ts).
 */

const CANONICAL_HOST = process.env.ADMIN_CANONICAL_HOST?.trim() || "";
const ALLOWED_HOSTS = new Set(
  (process.env.ADMIN_ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
if (CANONICAL_HOST) ALLOWED_HOSTS.add(CANONICAL_HOST.toLowerCase());

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || "120", 10);

type RateEntry = { count: number; resetAt: number };
const store = new Map<string, RateEntry>();
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

function isAllowedOrigin(originHeader: string, hostHeader: string): boolean {
  try {
    const originUrl = new URL(originHeader);
    return originUrl.host.toLowerCase() === hostHeader.toLowerCase();
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // --- Canonical domain redirect ---
  if (CANONICAL_HOST && ALLOWED_HOSTS.size > 0) {
    const host = request.headers.get("host")?.split(":")[0]?.toLowerCase() || "";
    if (host && host !== "localhost" && host !== CANONICAL_HOST.toLowerCase()) {
      if (!ALLOWED_HOSTS.has(host)) {
        const url = request.nextUrl.clone();
        url.host = CANONICAL_HOST;
        url.port = "";
        url.protocol = "https:";
        return NextResponse.redirect(url, 301);
      }
      // Allowed but non-canonical — redirect
      const url = request.nextUrl.clone();
      url.host = CANONICAL_HOST;
      url.port = "";
      url.protocol = "https:";
      return NextResponse.redirect(url, 301);
    }
  }

  // --- CSRF protection for mutating API requests (from proxy.ts) ---
  if (
    pathname.startsWith("/api/") &&
    pathname !== "/api/webhook/github" &&
    request.method !== "GET"
  ) {
    const originHeader = request.headers.get("Origin");
    const hostHeader = request.headers.get("Host");
    if (!originHeader || !hostHeader || !isAllowedOrigin(originHeader, hostHeader)) {
      return new NextResponse(null, { status: 403 });
    }
  }

  // --- Rate limiting (API routes only, skip webhooks) ---
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/webhook/")) {
    cleanup();

    const ip = getClientIp(request);
    const now = Date.now();
    let entry = store.get(ip);

    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(ip, entry);
    }

    entry.count++;

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
  }

  // --- Rate limiting for webhook routes (higher limit) ---
  if (pathname.startsWith("/api/webhook/")) {
    cleanup();
    const ip = getClientIp(request);
    const now = Date.now();
    const webhookKey = `webhook:${ip}`;
    let entry = store.get(webhookKey);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(webhookKey, entry);
    }
    entry.count++;
    if (entry.count > MAX_REQUESTS * 5) {
      return new NextResponse(null, { status: 429 });
    }
  }

  // --- Set x-return-to header for auth redirects (from proxy.ts) ---
  const requestHeaders = new Headers(request.headers);
  const safeReturnTo = `${pathname}${request.nextUrl.search}`.replace(/[\r\n]/g, "");
  requestHeaders.set("x-return-to", safeReturnTo);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|images/).*)",
  ],
};
