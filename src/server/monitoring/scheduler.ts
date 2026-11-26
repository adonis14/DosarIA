import "server-only";
import { serverEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runScheduledCheck, type CheckDeps } from "./check-case";

/**
 * One scheduler run: claim the cases that are due (claim_due_case_checks
 * leases them so concurrent runs never overlap) and check them one by one.
 *
 * Called by the protected endpoint /api/internal/scheduled-checks, which a
 * timer hits every minute. When each case is due is decided by schedule.ts
 * and stored after every check (manual or scheduled).
 *
 * Safety:
 * - Off unless SCHEDULED_CHECKS_ENABLED=true (checked by the endpoint).
 * - With the real portal provider configured but not approved, nothing is
 *   claimed or fetched at all (no stream of "provider disabled" runs).
 * - Checks run sequentially; the real provider also spaces its requests.
 * - The response and logs carry counts only, never case data.
 */

export type SchedulerRunResult =
  | { status: "ran"; claimed: number; recorded: number; notSaved: number; outcomes: Record<string, number> }
  | { status: "skipped"; reason: "provider_not_approved" };

export async function runDueChecks(opts: {
  limit: number;
  /** Only this organization's cases (a pilot firm, or tests). Default: all. */
  organizationId?: string;
  deps?: CheckDeps;
}): Promise<SchedulerRunResult> {
  const env = serverEnv();
  if (env.COURT_DATA_PROVIDER === "portaljust_soap" && !env.PORTAL_JUST_INTEGRATION_APPROVED) {
    return { status: "skipped", reason: "provider_not_approved" };
  }

  // Long enough for the whole batch (timeout + spacing per case), so a case is
  // never handed to a second run while the first is still working on it.
  const leaseSeconds = Math.min(3600, 60 + opts.limit * 30);
  const admin = createSupabaseAdminClient();
  const { data: due, error } = await admin.rpc("claim_due_case_checks", {
    p_limit: opts.limit,
    p_lease_seconds: leaseSeconds,
    p_organization_id: opts.organizationId,
  });
  if (error) {
    logServerError("claim_due_case_checks", error);
    throw new Error("Could not claim due checks");
  }

  const outcomes: Record<string, number> = {};
  let recorded = 0;
  let notSaved = 0;
  for (const c of due ?? []) {
    try {
      const result = await runScheduledCheck(
        {
          id: c.case_id,
          organization_id: c.organization_id,
          court_case_number: c.court_case_number,
          court_name: c.court_name,
          matter_type: c.matter_type,
        },
        opts.deps,
      );
      if (result) {
        recorded++;
        outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      } else {
        notSaved++; // lease expires; the case is retried by a later run
      }
    } catch (err) {
      notSaved++;
      logServerError("runScheduledCheck", err);
    }
  }
  return { status: "ran", claimed: due?.length ?? 0, recorded, notSaved, outcomes };
}
