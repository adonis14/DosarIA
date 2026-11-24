import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookieOptions } from "@/lib/supabase/cookies";

/**
 * Runs before every page request:
 *   1. Generates a per-request CSP nonce and sets a strict Content-Security-Policy.
 *   2. Refreshes the Supabase session cookie when needed.
 *   3. Optimistically redirects anonymous visitors away from private pages.
 *
 * This is NOT the authorization layer. Every page, Server Action and Route
 * Handler re-verifies the user server-side, and PostgreSQL RLS enforces
 * tenant isolation regardless of what happens here.
 */

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/confirm", "/auth/check-email", "/auth/error"];

function isPublic(pathname: string) {
  return pathname === "/" || PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function buildCsp(nonce: string, isHttps: boolean) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used by UI primitives; scripts remain nonce-locked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The browser never calls Supabase directly; only same-origin requests.
    `connect-src 'self'${isDev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only meaningful (and safe) when served over HTTPS, as in production.
    ...(isHttps ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  const isHttps =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const csp = buildCsp(nonce, isHttps);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  let cacheHeaders: Record<string, string> = {};

  let authenticated = false;
  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, { ...options, ...authCookieOptions() });
          }
          cacheHeaders = headers;
        },
      },
    });
    // getClaims() verifies the JWT (signature + expiry) and refreshes the
    // session if needed. Do not put logic between createServerClient and this call.
    const { data } = await supabase.auth.getClaims();
    authenticated = Boolean(data?.claims?.sub);
  }

  const { pathname, search } = request.nextUrl;
  if (!authenticated && !isPublic(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    const redirect = NextResponse.redirect(loginUrl);
    // Preserve any cookie changes (e.g. clearing an expired session).
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Content-Security-Policy", csp);
    return redirect;
  }

  response.headers.set("Content-Security-Policy", csp);
  for (const [key, value] of Object.entries(cacheHeaders)) response.headers.set(key, value);
  // Private, per-user pages must never be stored by shared caches.
  if (!isPublic(pathname) || authenticated) {
    response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
