import "server-only";
import { classifyDbError, fail, logServerError, type ActionResult } from "@/lib/errors";
import { createReminderSchema, fieldErrorsOf, reminderActionSchema, uuid } from "@/lib/validation";
import { roleIn, type AuthContext } from "@/server/context";
import { canEditCase, getAuthorizedCase } from "./cases";

export type ReminderStatus = "proposed" | "confirmed" | "completed" | "needs_review";

export type ReminderRow = {
  id: string;
  case_id: string;
  organization_id: string;
  source_event_id: string | null;
  title: string;
  description: string | null;
  due_date: string;
  origin: "manual" | "suggested";
  status: ReminderStatus;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
};

const REMINDER_COLUMNS =
  "id, case_id, organization_id, source_event_id, title, description, due_date, origin, status, created_by, confirmed_by, confirmed_at, completed_at, created_at";

export async function getCaseReminders(ctx: AuthContext, caseId: string): Promise<ReminderRow[]> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return [];
  const { data, error } = await ctx.supabase
    .from("deadline_reminders")
    .select(REMINDER_COLUMNS)
    .eq("case_id", id.data)
    .order("due_date", { ascending: true });
  if (error) {
    logServerError("getCaseReminders", error);
    throw new Error("Could not load reminders");
  }
  return (data ?? []) as ReminderRow[];
}

export type UpcomingReminderRow = ReminderRow & { cases: { court_case_number: string; title: string } | null };

/** Lawyer-confirmed reminders due from today on, in the active organization. */
export async function getUpcomingConfirmedReminders(ctx: AuthContext, days = 60): Promise<UpcomingReminderRow[]> {
  if (!ctx.activeOrg) return [];
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await ctx.supabase
    .from("deadline_reminders")
    .select(`${REMINDER_COLUMNS}, cases ( court_case_number, title )`)
    .eq("organization_id", ctx.activeOrg.organizationId)
    .eq("status", "confirmed")
    .gte("due_date", today)
    .lte("due_date", until)
    .order("due_date", { ascending: true })
    .limit(20);
  if (error) {
    logServerError("getUpcomingConfirmedReminders", error);
    return [];
  }
  return (data ?? []) as UpcomingReminderRow[];
}

export async function createReminder(ctx: AuthContext, caseId: string, input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createReminderSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const c = await getAuthorizedCase(ctx, caseId);
  if (!c) return fail(ctx.t, "not_found");
  if (!canEditCase(ctx, c)) return fail(ctx.t, "forbidden", ctx.t.errors.onlyAssignedAddsReminders);

  const { data, error } = await ctx.supabase
    .from("deadline_reminders")
    .insert({
      // organization_id is taken from the verified case row, never from the client.
      organization_id: c.organization_id,
      case_id: c.id,
      source_event_id: parsed.data.sourceEventId,
      title: parsed.data.title,
      description: parsed.data.description,
      due_date: parsed.data.dueDate,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error) {
    logServerError("createReminder", error);
    return fail(ctx.t, classifyDbError(error));
  }
  return { ok: true, data: { id: data.id } };
}

const NEXT_STATUS: Record<(typeof reminderActionSchema.shape.action.options)[number], ReminderStatus> = {
  confirm: "confirmed",
  complete: "completed",
  reopen: "confirmed",
  flag: "needs_review",
  unflag: "proposed",
};

/**
 * Status transitions. "confirm" is the lawyer's explicit act that turns a
 * proposed/suggested date into a confirmed deadline; it is recorded with the
 * confirming user and time by the database, never by the client.
 */
export async function changeReminderStatus(ctx: AuthContext, input: unknown): Promise<ActionResult> {
  const parsed = reminderActionSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const { data: reminder, error: readError } = await ctx.supabase
    .from("deadline_reminders")
    .select("id, case_id, organization_id, status")
    .eq("id", parsed.data.reminderId)
    .maybeSingle();
  if (readError) {
    logServerError("changeReminderStatus.read", readError);
    return fail(ctx.t, "internal");
  }
  if (!reminder) return fail(ctx.t, "not_found");

  const c = await getAuthorizedCase(ctx, reminder.case_id);
  if (!c) return fail(ctx.t, "not_found");
  const role = roleIn(ctx, c.organization_id);
  if (!canEditCase(ctx, c) || (role !== "admin" && role !== "lawyer")) {
    return fail(ctx.t, "forbidden", ctx.t.errors.onlyAssignedConfirms);
  }

  const { data, error } = await ctx.supabase
    .from("deadline_reminders")
    .update({ status: NEXT_STATUS[parsed.data.action] })
    .eq("id", reminder.id)
    .select("id")
    .maybeSingle();
  if (error) {
    const code = classifyDbError(error);
    if (code === "validation") return fail(ctx.t, "validation", ctx.t.errors.transitionNotAllowed);
    logServerError("changeReminderStatus", error);
    return fail(ctx.t, code);
  }
  if (!data) return fail(ctx.t, "forbidden");
  return { ok: true };
}

/** Spec alias: lawyer confirmation of a deadline. */
export function confirmDeadline(ctx: AuthContext, reminderId: string) {
  return changeReminderStatus(ctx, { reminderId, action: "confirm" });
}

export async function deleteReminder(ctx: AuthContext, reminderId: string): Promise<ActionResult> {
  const id = uuid.safeParse(reminderId);
  if (!id.success) return fail(ctx.t, "validation");
  const { data, error } = await ctx.supabase
    .from("deadline_reminders")
    .delete()
    .eq("id", id.data)
    .in("status", ["proposed", "needs_review"])
    .select("id");
  if (error) {
    logServerError("deleteReminder", error);
    return fail(ctx.t, classifyDbError(error));
  }
  if (!data || data.length === 0) return fail(ctx.t, "not_found", ctx.t.errors.onlyUnconfirmedDeletable);
  return { ok: true };
}
