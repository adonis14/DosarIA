"use server";

import { revalidatePath } from "next/cache";
import { fail, type ActionResult } from "@/lib/errors";
import { CHECK_OUTCOME_LABELS, ERROR_CODE_LABELS } from "@/lib/labels";
import { getAuthContext } from "@/server/context";
import { checkCaseForUpdates } from "@/server/monitoring/check-case";

export async function checkCaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const ctx = await getAuthContext();
  if (!ctx) return fail("unauthenticated");
  const caseId = String(formData.get("caseId") ?? "");

  const result = await checkCaseForUpdates(ctx, caseId);
  if (!result.ok) return result;
  revalidatePath(`/cases/${caseId}`);

  const { outcome, eventsCreated, errorCode } = result.data!;
  const headline = CHECK_OUTCOME_LABELS[outcome];
  if (outcome === "changes_detected") {
    return { ok: true, message: `${headline}: ${eventsCreated} eveniment(e) nou(i).` };
  }
  if (outcome === "no_changes") return { ok: true, message: `${headline} față de ultima verificare reușită.` };
  // Failures are reported as failures, never as "no changes".
  return fail("provider_failed", `${headline}. ${errorCode ? (ERROR_CODE_LABELS[errorCode] ?? "") : ""} Datele anterioare au fost păstrate.`);
}
