import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";
import { authCookieOptions } from "./cookies";
import type { Database } from "./database.types";

/**
 * User-scoped Supabase client. Requests carry the signed-in user's JWT, so
 * PostgreSQL Row Level Security applies to every query. This is the client
 * used for ALL normal user-facing reads and writes.
 */
export async function createSupabaseServerClient() {
  const env = serverEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, { ...options, ...authCookieOptions() });
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // proxy refreshes the session on every request, so this is safe.
        }
      },
    },
  });
}

export type UserSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
