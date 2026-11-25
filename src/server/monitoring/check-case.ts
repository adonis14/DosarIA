import "server-only";
import { fail, logServerError, type ActionResult } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { SUGGESTED_REMINDER_TEXT } from "@/lib/suggested-reminder";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";
import type { AuthContext } from "@/server/context";
import { getAuthorizedCase } from "@/server/dal/cases";
import { getSummaryProvider } from "@/server/summaries";
import type { SummaryProvider } from "@/server/summaries/types";
import { canonicalHash } from "./canonical";
import { detectChanges, type DetectedEvent } from "./diff";
import { normalizeCourtCase, type NormalizedCase } from "./normalize";
import { getCourtDataProvider } from "./providers";
import type { CourtDataProvider, ProviderResult } from "./types";

export type CheckOutcome = "changes_detected" | "no_changes" | "failed" | "incomplete" | "source_unavailable";

export type CheckResult = {
  outcome: CheckOutcome;
  eventsCreated: number;
  errorCode: string | null;
};

type Deps = {
  provider?: CourtDataProvider;
  summaries?: SummaryProvider;
  now?: () => Date;
  timeoutMs?: number;
};

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
};

/**
 * Manual "Check for updates".
 *
 * 1. Verify the caller and their access to the case with THEIR RLS-scoped
 *    client. Organization and case ids come from that verified row only.
 * 2. Fetch from the provider; treat the payload as untrusted.
 * 3. Normalize + validate; compare with the last COMPLETE snapshot.
 * 4. Record the run atomically via record_monitoring_run (service role),
 *    scoped to the verified (organization_id, case_id).
 *
 * A failed or partial fetch is recorded as such and never as "no changes";
 * the previous valid snapshot is left untouched.
 */
export async function checkCaseForUpdates(ctx: AuthContext, caseId: string, deps: Deps = {}): Promise<ActionResult<CheckResult>> {
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
  const summaries = deps.summaries ?? getSummaryProvider();
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();

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
  const [{ count: priorAttempts }, { data: lastSnapshot }] = await Promise.all([
    ctx.supabase.from("monitoring_runs").select("id", { count: "exact", head: true }).eq("case_id", c.id),
    ctx.supabase
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

  const record = async (input: RecordInput): Promise<ActionResult<CheckResult>> => {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("record_monitoring_run", {
      p_case_id: c.id,
      p_organization_id: c.organization_id,
      p_triggered_by: ctx.user.id,
      p_trigger_type: "manual",
      p_provider: provider.id,
      p_started_at: startedAt,
      p_finished_at: now().toISOString(),
      p_outcome: input.outcome,
      p_error_code: input.errorCode ?? undefined,
      p_court_status: input.courtStatus ?? undefined,
      p_snapshot: (input.snapshot ?? undefined) as Json | undefined,
      p_events: (input.events ?? []) as Json,
    });
    if (error || !data) {
      logServerError("record_monitoring_run", error);
      return fail(ctx.t, "internal", ctx.t.errors.checkNotSaved);
    }
    const result = data as { outcome: CheckOutcome; events_created: number };
    return {
      ok: true,
      data: { outcome: result.outcome, eventsCreated: result.events_created, errorCode: input.errorCode ?? null },
    };
  };

  let result: ProviderResult;
  try {
    result = await provider.fetchCase(
      { courtCaseNumber: c.court_case_number, courtName: c.court_name, attempt: priorAttempts ?? 0 },
      AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    );
  } catch (err) {
    logServerError("provider.fetchCase", err);
    return record({ outcome: "failed", errorCode: "provider_exception" });
  }

  if (result.kind === "unavailable") return record({ outcome: "source_unavailable", errorCode: "source_unavailable" });
  if (result.kind === "error") return record({ outcome: "failed", errorCode: result.errorCode });
  if (result.source.transport !== "mock" && result.source.transport !== "https") {
    return record({ outcome: "failed", errorCode: "insecure_transport_refused" });
  }

  const normalized = normalizeCourtCase(result.payload);
  if (normalized.kind === "invalid") return record({ outcome: "failed", errorCode: "invalid_response" });

  if (normalized.kind === "incomplete") {
    // Stored for audit, but never used as the comparison baseline.
    return record({
      outcome: "incomplete",
      errorCode: "missing_fields",
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
    return record({ outcome: "no_changes", courtStatus: next.status });
  }

  const previous = (lastSnapshot?.data ?? null) as NormalizedCase | null;
  const detected = detectChanges(previous, next, {
    previousHash: lastSnapshot?.content_hash ?? null,
    today: result.source.fetchedAt.slice(0, 10),
  });
  const events = await Promise.all(detected.map((e) => toEventPayload(e, summaries)));

  return record({
    outcome: events.length > 0 ? "changes_detected" : "no_changes",
    courtStatus: next.status,
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
