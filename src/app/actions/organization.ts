"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { formToObject, uuid } from "@/lib/validation";
import { ACTIVE_ORG_COOKIE, getAuthContext } from "@/server/context";
import {
  acceptInvitation,
  changeMemberRole,
  changeMemberStatus,
  createInvitation,
  createOrganization,
  renameOrganization,
  revokeInvitation,
  updateOwnProfile,
} from "@/server/dal/organizations";

async function setActiveOrgCookie(organizationId: string) {
  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
}

export async function createOrganizationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await createOrganization(ctx, formToObject(formData, ["name"]));
  if (!result.ok) return result;
  await setActiveOrgCookie(result.data!.id);
  redirect("/dashboard");
}

/** The cookie is only a preference; it is honoured only if the user is an active member. */
export async function switchOrganizationAction(formData: FormData): Promise<void> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const id = uuid.safeParse(formData.get("organizationId"));
  if (id.success && ctx.memberships.some((m) => m.organizationId === id.data)) {
    await setActiveOrgCookie(id.data);
  }
  redirect("/dashboard");
}

export async function renameOrganizationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx?.activeOrg) return fail(t, "unauthenticated");
  const result = await renameOrganization(ctx, ctx.activeOrg.organizationId, formToObject(formData, ["name"]));
  if (!result.ok) return result;
  revalidatePath("/settings");
  return { ok: true, message: t.success.orgRenamed };
}

export async function inviteMemberAction(
  _prev: ActionResult<{ link: string; expiresAt: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ link: string; expiresAt: string }>> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx?.activeOrg) return fail(t, "unauthenticated");
  if (!rateLimit(`invite:${ctx.user.id}`, LIMITS.invitation.limit, LIMITS.invitation.windowMs).ok) return fail(t, "rate_limited");
  const result = await createInvitation(ctx, ctx.activeOrg.organizationId, formToObject(formData, ["email", "role"]));
  if (!result.ok) return result;
  revalidatePath("/settings");
  return { ...result, message: t.success.invitationCreated };
}

export async function revokeInvitationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await revokeInvitation(ctx, String(formData.get("invitationId") ?? ""));
  if (!result.ok) return result;
  revalidatePath("/settings");
  return { ok: true };
}

export async function changeMemberRoleAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await changeMemberRole(ctx, formToObject(formData, ["membershipId", "role"]));
  if (!result.ok) return result;
  revalidatePath("/settings");
  return { ok: true, message: t.success.roleUpdated };
}

export async function changeMemberStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await changeMemberStatus(ctx, formToObject(formData, ["membershipId", "status"]));
  if (!result.ok) return result;
  revalidatePath("/settings");
  return { ok: true, message: t.success.statusUpdated };
}

export async function acceptInvitationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await acceptInvitation(ctx, formData.get("token"));
  if (!result.ok) return result;
  await setActiveOrgCookie(result.data!.organizationId);
  redirect("/dashboard");
}

export async function updateProfileAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await updateOwnProfile(ctx, formToObject(formData, ["fullName"]));
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return { ok: true, message: t.success.profileUpdated };
}
