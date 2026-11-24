"use server";

import { revalidatePath } from "next/cache";
import { fail, type ActionResult } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { getAuthContext } from "@/server/context";
import { changeReminderStatus, createReminder, deleteReminder } from "@/server/dal/reminders";

export async function createReminderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const caseId = String(formData.get("caseId") ?? "");
  const result = await createReminder(ctx, caseId, formToObject(formData, ["title", "description", "dueDate", "sourceEventId"]));
  if (!result.ok) return result;
  revalidatePath(`/cases/${caseId}`);
  return { ok: true, message: "Termenul a fost adăugat cu statutul „Propus”. Confirmați-l după verificare." };
}

export async function reminderStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const result = await changeReminderStatus(ctx, formToObject(formData, ["reminderId", "action"]));
  if (!result.ok) return result;
  const caseId = String(formData.get("caseId") ?? "");
  if (caseId) revalidatePath(`/cases/${caseId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteReminderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const result = await deleteReminder(ctx, String(formData.get("reminderId") ?? ""));
  if (!result.ok) return result;
  const caseId = String(formData.get("caseId") ?? "");
  if (caseId) revalidatePath(`/cases/${caseId}`);
  return { ok: true };
}
