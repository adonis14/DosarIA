import type { AuthContext, Membership } from "../../src/server/context";
import type { Db } from "./world";

/** Build an AuthContext from a signed-in client, resolving memberships through RLS like the app does. */
export async function contextFor(client: Db, activeOrgId?: string): Promise<AuthContext> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("not signed in");
  const { data } = await client
    .from("organization_memberships")
    .select("id, organization_id, role, organizations ( name )")
    .eq("user_id", user.id)
    .eq("status", "active");
  const memberships: Membership[] = (data ?? []).map((r) => ({
    membershipId: r.id,
    organizationId: r.organization_id,
    organizationName: r.organizations?.name ?? "",
    role: r.role,
  }));
  return {
    supabase: client as unknown as AuthContext["supabase"],
    user: { id: user.id, email: user.email ?? "", emailVerified: Boolean(user.email_confirmed_at) },
    memberships,
    activeOrg: memberships.find((m) => m.organizationId === activeOrgId) ?? memberships[0] ?? null,
  };
}
