"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { formToObject } from "@/lib/validation";
import { getAuthContext } from "@/server/context";
import { importCases, previewCaseImport, type ImportOutcome, type ImportPreview } from "@/server/dal/case-import";

/* Bulk import: the text is re-read and re-checked on both steps. */

const KEYS = ["data", "defaultAssigneeId"] as const;

export async function previewCaseImportAction(_prev: unknown, formData: FormData): Promise<ActionResult<ImportPreview>> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  return previewCaseImport(ctx, formToObject(formData, KEYS));
}

export async function importCasesAction(_prev: unknown, formData: FormData): Promise<ActionResult<ImportOutcome>> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await importCases(ctx, formToObject(formData, KEYS));
  if (result.ok) revalidatePath("/cases");
  return result;
}
