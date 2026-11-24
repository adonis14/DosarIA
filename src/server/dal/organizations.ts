import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { classifyDbError, fail, logServerError, type ActionResult } from "@/lib/errors";
import {
  fieldErrorsOf,
  invitationSchema,
  invitationTokenSchema,
  memberRoleSchema,
  memberStatusSchema,
  organizationNameSchema,
  profileSchema,
  uuid,
} from "@/lib/validation";
import { isAdminOf, type AuthContext, type Role } from "@/server/context";
import { logSecurityEvent } from "./audit";

export type MemberRow = {
  id: string;
  user_id: string;
  role: Role;
  status: "active" | "suspended" | "removed";
  created_at: string;
  profiles: { full_name: string | null; email: string } | null;
};

export type InvitationRow = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

/** Members of an organization the caller belongs to (RLS-filtered). */
export async function listMembers(ctx: AuthContext, organizationId: string): Promise<MemberRow[]> {
  const id = uuid.safeParse(organizationId);
  if (!id.success) return [];
  const { data, error } = await ctx.supabase
    .from("organization_memberships")
    .select("id, user_id, role, status, created_at, profiles ( full_name, email )")
    .eq("organization_id", id.data)
    .order("created_at", { ascending: true });
  if (error) {
    logServerError("listMembers", error);
    return [];
  }
  return (data ?? []) as MemberRow[];
}

export async function createOrganization(ctx: AuthContext, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = organizationNameSchema.safeParse(input);
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));
  if (!ctx.user.emailVerified) return fail("forbidden", "Confirmați mai întâi adresa de e-mail.");

  const { data, error } = await ctx.supabase.rpc("create_organization", { p_name: parsed.data.name });
  if (error) {
    if (error.code === "54000") return fail("forbidden", "Ați atins numărul maxim de organizații.");
    logServerError("createOrganization", error);
    return fail(classifyDbError(error));
  }
  return { ok: true, data: { id: data as string } };
}

export async function renameOrganization(ctx: AuthContext, organizationId: string, input: unknown): Promise<ActionResult> {
  const parsed = organizationNameSchema.safeParse(input);
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));
  if (!isAdminOf(ctx, organizationId)) return fail("forbidden");
  const { data, error } = await ctx.supabase
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", organizationId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) logServerError("renameOrganization", error);
    return fail(error ? classifyDbError(error) : "forbidden");
  }
  return { ok: true };
}

async function loadMembership(ctx: AuthContext, membershipId: string) {
  const { data } = await ctx.supabase
    .from("organization_memberships")
    .select("id, organization_id, user_id, role, status")
    .eq("id", membershipId)
    .maybeSingle();
  return data;
}

export async function changeMemberRole(ctx: AuthContext, input: unknown): Promise<ActionResult> {
  const parsed = memberRoleSchema.safeParse(input);
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));
  const membership = await loadMembership(ctx, parsed.data.membershipId);
  if (!membership) return fail("not_found");
  if (!isAdminOf(ctx, membership.organization_id)) {
    await logSecurityEvent(ctx, {
      action: "security.role_change_denied",
      resourceType: "membership",
      resourceId: membership.id,
      organizationId: membership.organization_id,
    });
    return fail("forbidden");
  }
  if (membership.user_id === ctx.user.id) return fail("forbidden", "Nu vă puteți modifica propriul rol.");

  const { data, error } = await ctx.supabase
    .from("organization_memberships")
    .update({ role: parsed.data.role })
    .eq("id", membership.id)
    .select("id")
    .maybeSingle();
  if (error) {
    const code = classifyDbError(error);
    if (code === "validation") return fail("validation", "Organizația trebuie să păstreze cel puțin un administrator activ.");
    logServerError("changeMemberRole", error);
    return fail(code);
  }
  if (!data) return fail("forbidden");
  return { ok: true };
}

export async function changeMemberStatus(ctx: AuthContext, input: unknown): Promise<ActionResult> {
  const parsed = memberStatusSchema.safeParse(input);
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));
  const membership = await loadMembership(ctx, parsed.data.membershipId);
  if (!membership) return fail("not_found");
  if (!isAdminOf(ctx, membership.organization_id)) return fail("forbidden");
  if (membership.user_id === ctx.user.id) return fail("forbidden", "Nu vă puteți modifica propriul statut.");

  const { data, error } = await ctx.supabase
    .from("organization_memberships")
    .update({ status: parsed.data.status })
    .eq("id", membership.id)
    .select("id")
    .maybeSingle();
  if (error) {
    const code = classifyDbError(error);
    if (code === "validation") return fail("validation", "Organizația trebuie să păstreze cel puțin un administrator activ.");
    logServerError("changeMemberStatus", error);
    return fail(code);
  }
  if (!data) return fail("forbidden");
  return { ok: true };
}

export async function listInvitations(ctx: AuthContext, organizationId: string): Promise<InvitationRow[]> {
  if (!isAdminOf(ctx, organizationId)) return [];
  const { data, error } = await ctx.supabase
    .from("organization_invitations")
    .select("id, email, role, expires_at, accepted_at, revoked_at, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    logServerError("listInvitations", error);
    return [];
  }
  return (data ?? []) as InvitationRow[];
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Creates an expiring (72 h), single-use invitation bound to an email
 * address. Returns the acceptance link ONCE; only the token's SHA-256 hash is
 * stored. Email delivery is deferred to the next phase: the admin shares the
 * link through a trusted channel.
 */
export async function createInvitation(
  ctx: AuthContext,
  organizationId: string,
  input: unknown,
): Promise<ActionResult<{ link: string; expiresAt: string }>> {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));
  if (!isAdminOf(ctx, organizationId)) {
    await logSecurityEvent(ctx, { action: "security.invitation_denied", resourceType: "organization", resourceId: null });
    return fail("forbidden");
  }

  // An expired-but-pending invite for the same email would block a new one.
  await ctx.supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("email", parsed.data.email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .lt("expires_at", new Date().toISOString());

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 72 * 3600_000).toISOString();
  const { error } = await ctx.supabase.from("organization_invitations").insert({
    organization_id: organizationId,
    email: parsed.data.email,
    role: parsed.data.role,
    token_hash: hashInvitationToken(token),
    invited_by: ctx.user.id,
    expires_at: expiresAt,
  });
  if (error) {
    const code = classifyDbError(error);
    if (code === "conflict") return fail("conflict", "Există deja o invitație activă pentru această adresă.");
    logServerError("createInvitation", error);
    return fail(code);
  }
  const link = `${serverEnv().APP_URL}/invite?token=${token}`;
  return { ok: true, data: { link, expiresAt } };
}

export async function revokeInvitation(ctx: AuthContext, invitationId: string): Promise<ActionResult> {
  const id = uuid.safeParse(invitationId);
  if (!id.success) return fail("validation");
  const { data, error } = await ctx.supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id.data)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    logServerError("revokeInvitation", error);
    return fail(classifyDbError(error));
  }
  if (!data) return fail("not_found");
  return { ok: true };
}

export async function acceptInvitation(ctx: AuthContext, rawToken: unknown): Promise<ActionResult<{ organizationId: string }>> {
  const token = invitationTokenSchema.safeParse(rawToken);
  if (!token.success) return fail("validation", "Invitația este invalidă sau a expirat.");
  const { data, error } = await ctx.supabase.rpc("accept_invitation", { p_token: token.data });
  if (error) {
    if (error.code === "22023") return fail("validation", "Invitația este invalidă sau a expirat.");
    if (error.code === "23505") return fail("conflict", "Sunteți deja membru al acestei organizații.");
    if (error.code === "42501") {
      return fail("forbidden", "Invitația a fost emisă pentru o altă adresă de e-mail sau adresa nu este confirmată.");
    }
    logServerError("acceptInvitation", error);
    return fail("internal");
  }
  return { ok: true, data: { organizationId: data as string } };
}

export async function updateOwnProfile(ctx: AuthContext, input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));
  const { error } = await ctx.supabase.from("profiles").update({ full_name: parsed.data.fullName }).eq("id", ctx.user.id);
  if (error) {
    logServerError("updateOwnProfile", error);
    return fail(classifyDbError(error));
  }
  return { ok: true };
}

export async function getOwnProfile(ctx: AuthContext) {
  const { data } = await ctx.supabase.from("profiles").select("id, email, full_name").eq("id", ctx.user.id).maybeSingle();
  return data;
}
