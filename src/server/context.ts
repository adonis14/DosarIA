import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDictionary, type Dictionary, type Locale } from "@/i18n";
import { getLocale } from "@/i18n/server";
import { createSupabaseServerClient, type UserSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { isMfaPending } from "@/server/mfa";

export type Role = Database["public"]["Enums"]["membership_role"];

export type Membership = {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  role: Role;
};

export type AuthContext = {
  supabase: UserSupabaseClient;
  user: { id: string; email: string; emailVerified: boolean };
  memberships: Membership[];
  /** Preferred organization for list views. A preference only — never proof of access. */
  activeOrg: Membership | null;
  /** Interface language for messages (presentation only — never used for authorization). */
  locale: Locale;
  t: Dictionary;
};

export const ACTIVE_ORG_COOKIE = "dosaria_active_org";

/**
 * Resolve the verified identity for this request.
 *
 * Identity: `auth.getUser()` validates the session with the Supabase Auth
 * server (detects revoked sessions), never a user id from the browser.
 * Roles: read from organization_memberships through RLS, never from JWT
 * or user metadata.
 */
const getSessionUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user, mfaPending: await isMfaPending(supabase, user) };
});

/**
 * A signed-in session that still has to enter its two-step code. Such a
 * session gets no AuthContext (the database would return nothing anyway).
 */
export const getMfaPendingSession = cache(async () => {
  const session = await getSessionUser();
  return session?.mfaPending ? { supabase: session.supabase, user: session.user } : null;
});

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await getSessionUser();
  if (!session || session.mfaPending) return null;
  const { supabase, user } = session;

  const { data: rows, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("id, organization_id, role, organizations ( name )")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (membershipError) throw new Error("Could not load memberships");

  const memberships: Membership[] = (rows ?? []).map((r) => ({
    membershipId: r.id,
    organizationId: r.organization_id,
    organizationName: r.organizations?.name ?? "—",
    role: r.role,
  }));

  const preferred = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const activeOrg = memberships.find((m) => m.organizationId === preferred) ?? memberships[0] ?? null;
  const locale = await getLocale();

  return {
    supabase,
    user: { id: user.id, email: user.email ?? "", emailVerified: Boolean(user.email_confirmed_at) },
    memberships,
    activeOrg,
    locale,
    t: getDictionary(locale),
  };
});

/** For pages: redirect anonymous visitors to the login page. */
export async function requirePageContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect((await getMfaPendingSession()) ? "/auth/mfa" : "/login");
  return ctx;
}

/** For pages that need an organization: send users without one to onboarding. */
export async function requireOrgPageContext(): Promise<AuthContext & { activeOrg: Membership }> {
  const ctx = await requirePageContext();
  if (!ctx.activeOrg) redirect("/onboarding");
  return ctx as AuthContext & { activeOrg: Membership };
}

/** Role of the caller in a specific organization (null if not an active member). */
export function roleIn(ctx: AuthContext, organizationId: string): Role | null {
  return ctx.memberships.find((m) => m.organizationId === organizationId)?.role ?? null;
}

export function isAdminOf(ctx: AuthContext, organizationId: string): boolean {
  return roleIn(ctx, organizationId) === "admin";
}
