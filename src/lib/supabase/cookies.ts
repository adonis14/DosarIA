import type { CookieOptions } from "@supabase/ssr";

/**
 * Auth cookie hardening. The app never creates a browser Supabase client, so
 * the session cookies can be HttpOnly (unreadable by page scripts, which
 * blunts token theft through XSS). SameSite=Lax blocks cross-site POSTs from
 * carrying the session; Secure is enforced in production.
 */
export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}
