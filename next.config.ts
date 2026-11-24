import type { NextConfig } from "next";

/**
 * Security headers for every response (pages, assets, route handlers). The
 * per-request nonce-based Content-Security-Policy is set in src/proxy.ts.
 */
const securityHeaders = [
  // HSTS: browsers will only use HTTPS for this host for 2 years. Has no
  // effect over plain-HTTP localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // All pages are private and per-user. Plain dynamic rendering (no
  // Partial Prerendering / cache components) guarantees private case data is
  // never baked into a prerendered or shared cache shell.
  cacheComponents: false,
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "256kb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
