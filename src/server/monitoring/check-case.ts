import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, logServerError, type ActionResult } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { SUGGESTED_REMINDER_TEXT } from "@/lib/suggested-reminder";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { AuthContext } from "@/server/context";
import { getAuthorizedCase } from "@/server/dal/cases";
import { getSummaryProvider } from "@/server/summaries";
import type { SummaryProvider } from "@/server/summaries/types";
import { canonicalHash } from "./canonical";
import { detectChanges, type DetectedEvent } from "./diff";
import { normalizeCourtCase, type NormalizedCase } from "./normalize";
import { getCourtDataProvider } from "./providers";
import { planNextCheck, type Plan } from "./schedule";
import type { CourtDataProvider, ProviderResult } from "./types";

export type CheckOutcome = "changes_detected" | "no_changes" | "failed" | "incomplete" | "source_unavailable";

export type CheckResult = {
  outcome: CheckOutcome;
  eventsCreated: number;
  errorCode: string | null;
  nextCheck: Plan;
};

export type CheckDeps = {
  provider?: CourtDataProvider;
  summaries?: SummaryProvider;
  now?: () => Date;
  timeoutMs?: number;
};

/** The case fields a check needs. Always taken from a VERIFIED row, never from user input. */
export type VerifiedCase = {
  id: string;
  organization_id: string;
  court_case_number: string;
  court_name: string;
  matter_type: string;
};

export type CheckTrigger = { type: "manual"; userId: string } | { type: "scheduled" };

type RecordInput = {
  outcome: CheckOutcome;
  errorCode?: string | null;
  courtStatus?: string | null;
  snapshot?: {
    source_reference: string | null;
    fetched_at: string;
    completeness: "complete" | "incomplete";
    content_hash: string;
    data: Json;
  } | null;
  events?: Json[];
  /** Hearings to plan the next check from (latest complete data). */
  hearings: NormalizedCase["hearings"] | null;
};

/**
 * Manual "Check for updates".
 *
 * 1. Verify the caller and their access to the case with THEIR RLS-scoped
 *    client. Organization and case ids come from that verified row only.
 * 2. Run the shared check (fetch, normalize, compare, record) — see performCheck.
 */
export async function checkCaseForUpdates(ctx: AuthContext, caseId: string, deps: CheckDeps = {}): Promise<ActionResult<CheckResult>> {
  const c = await getAuthorizedCase(ctx, caseId);
  if (!c) return fail(ctx.t, "not_found");
  if (c.status === "archived") return fail(ctx.t, "validation", ctx.t.errors.archivedNotMonitored);

  if (
    !rateLimit(`check:${ctx.user.id}:${c.id}`, LIMITS.monitoringPerCase.limit, LIMITS.monitoringPerCase.windowMs).ok ||
    !rateLimit(`check:${ctx.user.id}`, LIMITS.monitoringPerUser.limit, LIMITS.monitoringPerUser.windowMs).ok
  ) {
    return fail(ctx.t, "rate_limited");
  }

  const provider = deps.provider ?? getCourtDataProvider();
  const now = deps.now ?? (() => new Date());

  // Source-imposed minimum interval per file (e.g. the real portal). Refused
  // up front and NOT recorded, so a skipped check is never shown as "no changes".
  if (provider.minIntervalMs && c.last_check_attempt_at) {
    const nextAllowed = Date.parse(c.last_check_attempt_at) + provider.minIntervalMs;
    if (now().getTime() < nextAllowed) {
      const minutes = Math.ceil((nextAllowed - now().getTime()) / 60_000);
      return fail(ctx.t, "rate_limited", ctx.t.errors.checkedRecently(minutes));
    }
  }

  // Reads use the user's client: RLS guarantees these rows belong to this case.
  const result = await performCheck(c, ctx.supabase, { type: "manual", userId: ctx.user.id }, { ...deps, provider });
  if (!result) return fail(ctx.t, "internal", ctx.t.errors.checkNotSaved);
  return { ok: true, data: result };
}

/**
 * Scheduled check of a case handed out by claim_due_case_checks (service
 * role, see scheduler.ts). The case row comes from that trusted RPC, so no
 * user verification applies; the run is recorded with no triggering user.
 * Returns null if the run could not be saved (the lease then expires and the
 * case is retried).
 */
export async function runScheduledCheck(c: VerifiedCase, deps: CheckDeps = {}): Promise<CheckResult | null> {
  return performCheck(c, createSupabaseAdminClient(), { type: "scheduled" }, deps);
}

/**
 * The check itself:
 * 1. Fetch from the provider; treat the payload as untrusted.
 * 2. Normalize + validate; compare with the last COMPLETE snapshot.
 * 3. Plan the next automatic check.
 * 4. Record the run atomically via record_monitoring_run (service role),
 *    scoped to the verified (organization_id, case_id).
 *
 * A failed or partial fetch is recorded as such and never as "no changes";
 * the previous valid snapshot is left untouched.
 */
async function performCheck(
  c: VerifiedCase,
  reader: SupabaseClient<Database>,
  trigger: CheckTrigger,
  deps: CheckDeps,
): Promise<CheckResult | null> {
  const provider = deps.provider ?? getCourtDataProvider();
  const summaries = deps.summaries ?? getSummaryProvider();
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const [{ count: priorAttempts }, { data: lastSnapshot }] = await Promise.all([
    reader.from("monitoring_runs").select("id", { count: "exact", head: true }).eq("case_id", c.id),
    reader
      .from("case_snapshots")
      .select("content_hash, data")
      .eq("case_id", c.id)
      .eq("completeness", "complete")
      // Order by OUR insertion time, not the provider-supplied (untrusted, possibly
      // equal or skewed) fetched_at, so the baseline is always the latest recorded state.
      .order("created_at", { ascending: false })
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const previous = (lastSnapshot?.data ?? null) as NormalizedCase | null;

  const record = async (input: RecordInput): Promise<CheckResult | null> => {
    const finishedAt = now();
    const nextCheck = planNextCheck({
      now: finishedAt,
      matterType: c.matter_type,
      hearings: input.hearings,
      lastOutcome: input.outcome,
      lastAttemptAt: finishedAt,
      minIntervalMs: provider.minIntervalMs,
    });
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("record_monitoring_run", {
      p_case_id: c.id,
      p_organization_id: c.organization_id,
      // A scheduled run is system-initiated and has no triggering user.
      p_triggered_by: (trigger.type === "manual" ? trigger.userId : null) as string,
      p_trigger_type: trigger.type,
      p_provider: provider.id,
      p_started_at: startedAt,
      p_finished_at: finishedAt.toISOString(),
      p_outcome: input.outcome,
      p_error_code: input.errorCode ?? undefined,
      p_court_status: input.courtStatus ?? undefined,
      p_snapshot: (input.snapshot ?? undefined) as Json | undefined,
      p_events: (input.events ?? []) as Json,
      p_next_check_at: nextCheck.at.toISOString(),
      p_next_check_reason: nextCheck.reason,
    });
    if (error || !data) {
      logServerError("record_monitoring_run", error);
      return null;
    }
    const result = data as { outcome: CheckOutcome; events_created: number };
    return { outcome: result.outcome, eventsCreated: result.events_created, errorCode: input.errorCode ?? null, nextCheck };
  };

  const keepPrevious = previous?.hearings ?? null;

  let result: ProviderResult;
  try {
    result = await provider.fetchCase(
      { courtCaseNumber: c.court_case_number, courtName: c.court_name, attempt: priorAttempts ?? 0 },
      AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    );
  } catch (err) {
    logServerError("provider.fetchCase", err);
    return record({ outcome: "failed", errorCode: "provider_exception", hearings: keepPrevious });
  }

  if (result.kind === "unavailable") {
    return record({ outcome: "source_unavailable", errorCode: "source_unavailable", hearings: keepPrevious });
  }
  if (result.kind === "error") return record({ outcome: "failed", errorCode: result.errorCode, hearings: keepPrevious });
  if (result.source.transport !== "mock" && result.source.transport !== "https") {
    return record({ outcome: "failed", errorCode: "insecure_transport_refused", hearings: keepPrevious });
  }

  const normalized = normalizeCourtCase(result.payload);
  if (normalized.kind === "invalid") return record({ outcome: "failed", errorCode: "invalid_response", hearings: keepPrevious });

  if (normalized.kind === "incomplete") {
    // Stored for audit, but never used as the comparison baseline.
    return record({
      outcome: "incomplete",
      errorCode: "missing_fields",
      hearings: keepPrevious,
      snapshot: {
        source_reference: result.source.sourceReference,
        fetched_at: result.source.fetchedAt,
        completeness: "incomplete",
        content_hash: canonicalHash(normalized.data),
        data: normalized.data as unknown as Json,
      },
    });
  }

  const next = normalized.data;
  const contentHash = canonicalHash(next);
  if (lastSnapshot && lastSnapshot.content_hash === contentHash) {
    return record({ outcome: "no_changes", courtStatus: next.status, hearings: next.hearings });
  }

  const detected = detectChanges(previous, next, {
    previousHash: lastSnapshot?.content_hash ?? null,
    today: result.source.fetchedAt.slice(0, 10),
  });
  const events = await Promise.all(detected.map((e) => toEventPayload(e, summaries)));

  return record({
    outcome: events.length > 0 ? "changes_detected" : "no_changes",
    courtStatus: next.status,
    hearings: next.hearings,
    snapshot: {
      source_reference: result.source.sourceReference,
      fetched_at: result.source.fetchedAt,
      completeness: "complete",
      content_hash: contentHash,
      data: next as unknown as Json,
    },
    events,
  });
}

async function toEventPayload(event: DetectedEvent, summaries: SummaryProvider): Promise<Json> {
  const summary = await summaries.summarize(event);
  return {
    event_type: event.type,
    event_key: event.eventKey,
    occurred_on: event.occurredOn,
    details: event.details,
    summary_ro: summary.ro,
    summary_en: summary.en,
    summary_source: summary.source,
    requires_review: event.requiresReview,
    ...(event.suggestedReminderDate
      ? {
          suggested_reminder: {
            title: SUGGESTED_REMINDER_TEXT.title,
            description: SUGGESTED_REMINDER_TEXT.description,
            due_date: event.suggestedReminderDate,
          },
        }
      : {}),
  };
}
