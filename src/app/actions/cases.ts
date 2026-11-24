"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fail, type ActionResult } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { getAuthContext } from "@/server/context";
import { archiveCase, assignCase, createCase, updateCase } from "@/server/dal/cases";

/*
 * Every action independently re-verifies the session. Only whitelisted form
 * keys are read (formToObject), so injected fields such as organization_id,
 * assigned_user_id or created_by are never even seen by the DAL; the DAL's
 * strict Zod schemas would reject them anyway.
 */

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

export async function createCaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const result = await createCase(
    ctx,
    formToObject(formData, ["courtCaseNumber", "courtName", "title", "matterType", "assignedUserId", "assignedAssistantId"]),
  );
  if (!result.ok) return result;
  revalidatePath("/cases");
  redirect(`/cases/${result.data!.id}`);
}

export async function updateCaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const caseId = str(formData, "caseId");
  const result = await updateCase(ctx, caseId, formToObject(formData, ["courtCaseNumber", "courtName", "title", "matterType", "status"]));
  if (!result.ok) return result;
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  redirect(`/cases/${caseId}`);
}

export async function assignCaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const caseId = str(formData, "caseId");
  const result = await assignCase(ctx, caseId, formToObject(formData, ["assignedUserId", "assignedAssistantId"]));
  if (!result.ok) return result;
  revalidatePath(`/cases/${caseId}`);
  return { ok: true, message: "Alocarea a fost actualizată." };
}

export async function archiveCaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const caseId = str(formData, "caseId");
  const result = await archiveCase(ctx, caseId);
  if (!result.ok) return result;
  revalidatePath("/cases");
  redirect("/cases");
}
