"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { getAuthContext } from "@/server/context";
import { createLabel, deleteLabel, getLabelIdsForCases, setCaseLabels, updateLabel } from "@/server/dal/labels";
import { addCaseNote, deleteCaseNote, updateCaseNote } from "@/server/dal/notes";

/* Labels and notes. Only whitelisted form keys are read; the DAL re-validates. */

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
};

export async function createLabelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await createLabel(ctx, formToObject(formData, ["name", "color"]));
  if (!result.ok) return result;
  // Created from a case page: attach it to that case straight away (current labels read from the database).
  const caseId = str(formData, "caseId");
  if (caseId) {
    const current = (await getLabelIdsForCases(ctx, [caseId])).get(caseId) ?? [];
    const attached = await setCaseLabels(ctx, caseId, { labelIds: [...current, result.data!.id] });
    if (!attached.ok) return attached;
    revalidatePath(`/cases/${caseId}`);
  }
  revalidatePath("/cases/labels");
  return { ok: true, message: t.success.labelCreated };
}

export async function updateLabelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await updateLabel(ctx, str(formData, "labelId"), formToObject(formData, ["name", "color"]));
  if (!result.ok) return result;
  revalidatePath("/cases", "layout");
  return { ok: true, message: t.success.labelUpdated };
}

export async function deleteLabelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await deleteLabel(ctx, str(formData, "labelId"));
  if (!result.ok) return result;
  revalidatePath("/cases", "layout");
  return { ok: true, message: t.success.labelDeleted };
}

export async function setCaseLabelsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const caseId = str(formData, "caseId");
  const labelIds = formData.getAll("labelId").filter((v): v is string => typeof v === "string");
  const result = await setCaseLabels(ctx, caseId, { labelIds });
  if (!result.ok) return result;
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return { ok: true, message: t.success.labelsSaved };
}

export async function addCaseNoteAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const caseId = str(formData, "caseId");
  const result = await addCaseNote(ctx, caseId, formToObject(formData, ["body", "private"]));
  if (result.ok) revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function updateCaseNoteAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await updateCaseNote(ctx, str(formData, "noteId"), formToObject(formData, ["body", "private"]));
  if (!result.ok) return result;
  revalidatePath(`/cases/${result.data!.caseId}`);
  return { ok: true, message: result.message };
}

export async function deleteCaseNoteAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await deleteCaseNote(ctx, str(formData, "noteId"));
  if (!result.ok) return result;
  revalidatePath(`/cases/${result.data!.caseId}`);
  return { ok: true, message: t.success.noteDeleted };
}
