"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { getAuthContext } from "@/server/context";
import { followCase, markNotificationsRead, saveNotificationPreferences, unfollowCase } from "@/server/dal/notifications";

export async function markNotificationsReadAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await markNotificationsRead(ctx, formToObject(formData, ["notificationId", "scope"]));
  if (!result.ok) return result;
  // The unread badge is in the shared layout.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function saveNotificationPreferencesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await saveNotificationPreferences(ctx, formToObject(formData, ["courtUpdates", "checkProblems"]));
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return { ok: true, message: t.success.alertSettingsSaved };
}

export async function followCaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const caseId = String(formData.get("caseId") ?? "");
  const result = formData.get("follow") === "off" ? await unfollowCase(ctx, caseId) : await followCase(ctx, caseId);
  if (!result.ok) return result;
  revalidatePath(`/cases/${caseId}`);
  return { ok: true };
}
