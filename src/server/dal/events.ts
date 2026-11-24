import "server-only";
import { logServerError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import type { AuthContext } from "@/server/context";

export type CaseEventRow = {
  id: string;
  case_id: string;
  event_type:
    | "monitoring_started"
    | "hearing_scheduled"
    | "hearing_rescheduled"
    | "hearing_postponed"
    | "decision_issued"
    | "status_changed"
    | "stage_changed";
  occurred_on: string | null;
  summary_ro: string;
  summary_en: string | null;
  summary_source: string;
  requires_review: boolean;
  detected_at: string;
};

export type MonitoringRunRow = {
  id: string;
  outcome: "changes_detected" | "no_changes" | "failed" | "incomplete" | "source_unavailable" | "never_checked";
  events_created: number;
  error_code: string | null;
  provider: string;
  started_at: string;
  finished_at: string;
};

const EVENT_COLUMNS =
  "id, case_id, event_type, occurred_on, summary_ro, summary_en, summary_source, requires_review, detected_at";

/** Events of one case; RLS returns nothing unless the caller may read the parent case. */
export async function getAuthorizedCaseEvents(ctx: AuthContext, caseId: string, limit = 100): Promise<CaseEventRow[]> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return [];
  const { data, error } = await ctx.supabase
    .from("case_events")
    .select(EVENT_COLUMNS)
    .eq("case_id", id.data)
    .order("detected_at", { ascending: false })
    .limit(limit);
  if (error) {
    logServerError("getAuthorizedCaseEvents", error);
    throw new Error("Could not load events");
  }
  return (data ?? []) as CaseEventRow[];
}

export type RecentEventRow = CaseEventRow & { cases: { court_case_number: string; title: string } | null };

export async function getRecentEvents(ctx: AuthContext, limit = 10): Promise<RecentEventRow[]> {
  if (!ctx.activeOrg) return [];
  const { data, error } = await ctx.supabase
    .from("case_events")
    .select(`${EVENT_COLUMNS}, cases ( court_case_number, title )`)
    .eq("organization_id", ctx.activeOrg.organizationId)
    .neq("event_type", "monitoring_started")
    .order("detected_at", { ascending: false })
    .limit(limit);
  if (error) {
    logServerError("getRecentEvents", error);
    return [];
  }
  return (data ?? []) as RecentEventRow[];
}

export async function getCaseMonitoringRuns(ctx: AuthContext, caseId: string, limit = 10): Promise<MonitoringRunRow[]> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return [];
  const { data, error } = await ctx.supabase
    .from("monitoring_runs")
    .select("id, outcome, events_created, error_code, provider, started_at, finished_at")
    .eq("case_id", id.data)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    logServerError("getCaseMonitoringRuns", error);
    return [];
  }
  return (data ?? []) as MonitoringRunRow[];
}
