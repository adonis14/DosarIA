import "server-only";
import { z } from "zod";

/**
 * Server-only environment. Nothing here is prefixed NEXT_PUBLIC_, so none of
 * it is ever inlined into browser bundles. The browser never talks to
 * Supabase directly: all auth and data access happens on the server.
 */

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const isLocalHost = (url: string) => {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
};

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url(),
    SUPABASE_URL: z.url(),
    /** Publishable (anon) key: identifies the project; all access is still governed by RLS. */
    SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
    /** Secret (service-role) key: used ONLY by src/lib/supabase/admin.ts. */
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
    COURT_DATA_PROVIDER: z.enum(["mock", "portaljust_soap"]).default("mock"),
    MOCK_COURT_ANCHOR_DATE: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .default("2026-12-12"),
    MOCK_COURT_LATENCY_MS: z.coerce.number().int().min(0).max(5000).default(300),
    PORTAL_JUST_SOAP_ENDPOINT: z.string().default("https://portalquery.just.ro/query.asmx"),
    PORTAL_JUST_INTEGRATION_APPROVED: bool,
    PORTAL_JUST_MIN_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(1440).default(60),
    PORTAL_JUST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
    AI_PROVIDER_ENABLED: bool,
    AI_EU_PROCESSING_VERIFIED: bool,
    AI_DPA_SIGNED: bool,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") return;
    // Production must use HTTPS end to end (localhost is allowed for local `next start` runs).
    for (const key of ["APP_URL", "SUPABASE_URL"] as const) {
      const value = env[key];
      if (new URL(value).protocol !== "https:" && !isLocalHost(value)) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} must use https in production` });
      }
    }
  });

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Report variable NAMES only, never values.
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`Invalid server environment configuration: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

export const isProduction = () => process.env.NODE_ENV === "production";
