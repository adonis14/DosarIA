import "server-only";
import { classifyDbError, fail, logServerError, type ActionResult } from "@/lib/errors";
import { fieldErrorsOf, recordCommunicationSchema, rulingFollowupActionSchema, uuid } from "@/lib/validation";
import type { Database } from "@/lib/supabase/database.types";
import { roleIn, type AuthContext } from "@/server/context";
import { canEditCase, getAuthorizedCase } from "./cases";

/**
 * Ruling follow-up: after a ruling is detected, the responsible lawyer
 * records when it was communicated and the deadline date THEY determined.
 * The app calculates nothing. All access uses the user's own client, so RLS,
 * column grants and the database guard apply.
 */

export type RulingFollowupStatus = "awaiting_communication" | "recorded" | "not_needed";

export type RulingFollowupRow = {
  id: string;
  status: RulingFollowupStatus;
  communicated_on: string | null;
  note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  case_events: { occurred_on: string | null; details: Record<string, string | null> } | null;
  deadline_reminders: { title: string; due_date: string; status: Database["public"]["Enums"]["reminder_status"] } | null;
};

const FOLLOWUP_COLUMNS = `id, status, communicated_on, note, resolved_by, resolved_at, created_at,
  case_events!ruling_followups_event_fk ( occurred_on, details ),
  deadline_reminders!ruling_followups_reminder_fk ( title, due_date, status )`;

export async function getCaseRulingFollowups(ctx: AuthContext, caseId: string): Promise<RulingFollowupRow[]> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return [];
  const { data, error } = await ctx.supabase
    .from("ruling_followups")
    .select(FOLLOWUP_COLUMNS)
    .eq("case_id", id.data)
    .order("created_at", { ascending: false });
  if (error) {
    logServerError("getCaseRulingFollowups", error);
    throw new Error("Could not load ruling follow-ups");
  }
  return (data ?? []) as unknown as RulingFollowupRow[];
}

/** Open tasks in the active organization that the caller can see (all of them for admins). */
export async function countOpenRulingFollowups(ctx: AuthContext): Promise<number> {
  if (!ctx.activeOrg) return 0;
  const { count, error } = await ctx.supabase
    .from("ruling_followups")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.activeOrg.organizationId)
    .eq("status", "awaiting_communication");
  if (error) {
    logServerError("countOpenRulingFollowups", error);
    return 0;
  }
  return count ?? 0;
}

export type MyRulingFollowupRow = Database["public"]["Functions"]["my_open_ruling_followups"]["Returns"][number];

/** The caller's own open tasks (assigned or followed cases). */
export async function getMyOpenRulingFollowups(ctx: AuthContext): Promise<MyRulingFollowupRow[]> {
  if (!ctx.activeOrg) return [];
  const { data, error } = await ctx.supabase.rpc("my_open_ruling_followups", {
    p_organization_id: ctx.activeOrg.organizationId,
  });
  if (error) {
    logServerError("getMyOpenRulingFollowups", error);
    throw new Error("Could not load ruling follow-ups");
  }
  return data ?? [];
}

/** Load a follow-up through RLS and check that the caller may resolve it. */
async function authorizeFollowup(ctx: AuthContext, followupId: string) {
  const { data, error } = await ctx.supabase
    .from("ruling_followups")
    .select("id, case_id, status")
    .eq("id", followupId)
    .maybeSingle();
  if (error) {
    logServerError("authorizeFollowup", error);
    return { ok: false as const, error: fail(ctx.t, "internal") };
  }
  if (!data) return { ok: false as const, error: fail(ctx.t, "not_found") };
  const c = await getAuthorizedCase(ctx, data.case_id);
  if (!c) return { ok: false as const, error: fail(ctx.t, "not_found") };
  const role = roleIn(ctx, c.organization_id);
  if (!canEditCase(ctx, c) || (role !== "admin" && role !== "lawyer")) {
    return { ok: false as const, error: fail(ctx.t, "forbidden", ctx.t.errors.onlyAssignedRecordsRuling) };
  }
  return { ok: true as const, followup: data, caseId: c.id };
}

/** Record the communication date and create the lawyer's own deadline (status "proposed"). */
export async function recordRulingCommunication(
  ctx: AuthContext,
  input: unknown,
): Promise<ActionResult<{ reminderId: string; caseId: string }>> {
  const parsed = recordCommunicationSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const auth = await authorizeFollowup(ctx, parsed.data.followupId);
  if (!auth.ok) return auth.error;
  if (auth.followup.status !== "awaiting_communication") return fail(ctx.t, "conflict", ctx.t.errors.followupNotOpen);

  const { data, error } = await ctx.supabase.rpc("record_ruling_communication", {
    p_followup_id: parsed.data.followupId,
    p_communicated_on: parsed.data.communicatedOn,
    p_deadline_date: parsed.data.deadlineDate,
    p_deadline_title: parsed.data.title,
  });
  if (error) {
    const code = classifyDbError(error);
    if (code === "validation") return fail(ctx.t, "validation", ctx.t.errors.followupDatesInvalid);
    logServerError("recordRulingCommunication", error);
    return fail(ctx.t, code);
  }
  return { ok: true, data: { reminderId: data as string, caseId: auth.caseId } };
}

/** "No deadline to track" (with an optional note), or reopen such a task. */
export async function changeRulingFollowup(ctx: AuthContext, input: unknown): Promise<ActionResult<{ caseId: string }>> {
  const parsed = rulingFollowupActionSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const auth = await authorizeFollowup(ctx, parsed.data.followupId);
  if (!auth.ok) return auth.error;

  const update =
    parsed.data.action === "not_needed"
      ? { status: "not_needed", note: parsed.data.note }
      : { status: "awaiting_communication", note: null };
  const { data, error } = await ctx.supabase
    .from("ruling_followups")
    .update(update)
    .eq("id", auth.followup.id)
    .select("id")
    .maybeSingle();
  if (error) {
    const code = classifyDbError(error);
    if (code === "validation") return fail(ctx.t, "validation", ctx.t.errors.transitionNotAllowed);
    logServerError("changeRulingFollowup", error);
    return fail(ctx.t, code);
  }
  if (!data) return fail(ctx.t, "forbidden");
  return { ok: true, data: { caseId: auth.caseId } };
}
