import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * PRIVILEGED client (secret / service-role key). Bypasses Row Level Security.
 *
 * Allowed uses (enforced by an ESLint import restriction):
 *   - src/server/monitoring/check-case.ts: recording a monitoring run AFTER
 *     the user's access to the case was verified with their own RLS-scoped
 *     client; organization and case ids come from that verified row.
 *   - src/server/dal/audit.ts: appending security audit events.
 *
 * Never use it for user-facing CRUD, never pass it to client components, and
 * always scope every statement by organization_id AND resource id.
 */
export function createSupabaseAdminClient() {
  const env = serverEnv();
  if (!env.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is not configured");
  }
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
