"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { getAuthContext } from "@/server/context";
import { changeRulingFollowup, recordRulingCommunication } from "@/server/dal/rulings";

export async function recordCommunicationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await recordRulingCommunication(ctx, formToObject(formData, ["followupId", "communicatedOn", "deadlineDate", "title"]));
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return { ok: true, message: t.success.communicationRecorded };
}

export async function rulingFollowupAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await changeRulingFollowup(ctx, formToObject(formData, ["followupId", "action", "note"]));
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  return { ok: true };
}
