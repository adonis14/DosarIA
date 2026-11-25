"use server";

import { revalidatePath } from "next/cache";
import { label } from "@/i18n";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { getAuthContext } from "@/server/context";
import { checkCaseForUpdates } from "@/server/monitoring/check-case";

export async function checkCaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const caseId = String(formData.get("caseId") ?? "");

  const result = await checkCaseForUpdates(ctx, caseId);
  if (!result.ok) return result;
  revalidatePath(`/cases/${caseId}`);

  const { outcome, eventsCreated, errorCode } = result.data!;
  const headline = t.labels.checkOutcome[outcome];
  if (outcome === "changes_detected") {
    return { ok: true, message: t.monitoring.changesDetected(headline, eventsCreated) };
  }
  if (outcome === "no_changes") return { ok: true, message: t.monitoring.noChanges(headline) };
  // Failures are reported as failures, never as "no changes".
  const detail = errorCode ? label(t.labels.errorCode, errorCode) : "";
  return fail(t, "provider_failed", t.monitoring.failed(headline, detail));
}
