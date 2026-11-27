"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { getAuthContext } from "@/server/context";
import { confirmEnrollment, removeFactor, startEnrollment, type MfaEnrollment } from "@/server/mfa";

/*
 * Two-step verification settings (profile page). Only a fully signed-in
 * session (AuthContext) may change them; a password-only session waiting for
 * its code has no AuthContext.
 */

export async function startMfaEnrollmentAction(): Promise<ActionResult<MfaEnrollment>> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  return startEnrollment(ctx.supabase, ctx.user.id, t);
}

export async function confirmMfaEnrollmentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await confirmEnrollment(ctx.supabase, ctx.user.id, t, formToObject(formData, ["factorId", "code"]));
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function removeMfaFactorAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await removeFactor(ctx.supabase, ctx.user.id, t, formToObject(formData, ["factorId", "code"]));
  if (result.ok) revalidatePath("/profile");
  return result;
}
