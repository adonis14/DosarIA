import "server-only";
import { classifyDbError, fail, logServerError, type ActionResult } from "@/lib/errors";
import { fieldErrorsOf, markNotificationsReadSchema, notificationPreferencesSchema, uuid } from "@/lib/validation";
import type { Database } from "@/lib/supabase/database.types";
import type { AuthContext } from "@/server/context";
import { getAuthorizedCase } from "./cases";

/**
 * Per-person notifications. Every query runs with the user's own client, so
 * RLS limits rows to the caller's own notifications on cases they can still
 * read. Notifications are created by database triggers only (see the
 * notifications migration); this module reads them, marks them read, and
 * manages the caller's own alert settings and follows.
 */

export type NotificationKind =
  | "court_update"
  | "check_problem"
  | "reminder_added"
  | "reminder_needs_review"
  | "case_assigned";

type EventType = Database["public"]["Enums"]["event_type"];
type CheckOutcome = Database["public"]["Enums"]["check_outcome"];

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  case_id: string;
  created_at: string;
  read_at: string | null;
  check_outcome: CheckOutcome | null;
  cases: { court_case_number: string; title: string } | null;
  case_events: { event_type: EventType; summary_ro: string; summary_en: string | null } | null;
  deadline_reminders: { title: string; description: string | null; due_date: string; origin: "manual" | "suggested" } | null;
};

const NOTIFICATION_COLUMNS = `id, kind, case_id, created_at, read_at, check_outcome,
  cases!notifications_case_fk ( court_case_number, title ),
  case_events!notifications_event_fk ( event_type, summary_ro, summary_en ),
  deadline_reminders!notifications_reminder_fk ( title, description, due_date, origin )`;

/** Newest first, in the active organization. */
export async function listNotifications(ctx: AuthContext, limit = 50): Promise<NotificationRow[]> {
  if (!ctx.activeOrg) return [];
  const { data, error } = await ctx.supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS)
    .eq("organization_id", ctx.activeOrg.organizationId)
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) {
    logServerError("listNotifications", error);
    throw new Error("Could not load notifications");
  }
  return (data ?? []) as unknown as NotificationRow[];
}

/** Unread count for the header badge (0 on any error: the badge is a convenience). */
export async function getUnreadNotificationCount(ctx: AuthContext): Promise<number> {
  if (!ctx.activeOrg) return 0;
  const { count, error } = await ctx.supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.activeOrg.organizationId)
    .eq("user_id", ctx.user.id)
    .is("read_at", null);
  if (error) {
    logServerError("getUnreadNotificationCount", error);
    return 0;
  }
  return count ?? 0;
}

/** Mark one notification, or all in the active organization, as read. */
export async function markNotificationsRead(ctx: AuthContext, input: unknown): Promise<ActionResult<{ count: number }>> {
  const parsed = markNotificationsReadSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));
  if (!ctx.activeOrg) return fail(ctx.t, "forbidden");

  let query = ctx.supabase
    .from("notifications")
    // The database replaces this with its own time (guard trigger).
    .update({ read_at: new Date().toISOString() }, { count: "exact" })
    .eq("user_id", ctx.user.id)
    .is("read_at", null);
  query = parsed.data.notificationId
    ? query.eq("id", parsed.data.notificationId)
    : query.eq("organization_id", ctx.activeOrg.organizationId);
  const { error, count } = await query;
  if (error) {
    logServerError("markNotificationsRead", error);
    return fail(ctx.t, classifyDbError(error));
  }
  return { ok: true, data: { count: count ?? 0 } };
}

/** The caller has just seen this case's latest state (e.g. after "Check now"). */
export async function markCaseNotificationsRead(ctx: AuthContext, caseId: string): Promise<void> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return;
  const { error } = await ctx.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", ctx.user.id)
    .eq("case_id", id.data)
    .is("read_at", null);
  if (error) logServerError("markCaseNotificationsRead", error);
}

export type NotificationPreferences = { courtUpdates: boolean; checkProblems: boolean };
const DEFAULT_PREFERENCES: NotificationPreferences = { courtUpdates: true, checkProblems: true };

export async function getNotificationPreferences(ctx: AuthContext): Promise<NotificationPreferences> {
  if (!ctx.activeOrg) return DEFAULT_PREFERENCES;
  const { data, error } = await ctx.supabase
    .from("notification_preferences")
    .select("court_updates, check_problems")
    .eq("organization_id", ctx.activeOrg.organizationId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) {
    logServerError("getNotificationPreferences", error);
    throw new Error("Could not load alert settings");
  }
  return data ? { courtUpdates: data.court_updates, checkProblems: data.check_problems } : DEFAULT_PREFERENCES;
}

/** Save the caller's own settings for the active organization. */
export async function saveNotificationPreferences(ctx: AuthContext, input: unknown): Promise<ActionResult> {
  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));
  if (!ctx.activeOrg) return fail(ctx.t, "forbidden");

  const orgId = ctx.activeOrg.organizationId;
  const values = { court_updates: parsed.data.courtUpdates, check_problems: parsed.data.checkProblems };

  // Update, else insert: users have no UPDATE right on the key columns, so an
  // upsert (which rewrites them) is not allowed.
  const update = () =>
    ctx.supabase
      .from("notification_preferences")
      .update(values, { count: "exact" })
      .eq("organization_id", orgId)
      .eq("user_id", ctx.user.id);
  let { error, count } = await update();
  if (!error && count === 0) {
    ({ error } = await ctx.supabase
      .from("notification_preferences")
      .insert({ organization_id: orgId, user_id: ctx.user.id, ...values }));
    if (error?.code === "23505") ({ error, count } = await update()); // saved concurrently
  }
  if (error) {
    logServerError("saveNotificationPreferences", error);
    return fail(ctx.t, classifyDbError(error));
  }
  return { ok: true };
}

/** Why (or whether) the caller gets alerts for a case. */
export type CaseAlertStatus = "assigned" | "following" | "not_following";

export async function getCaseAlertStatus(
  ctx: AuthContext,
  c: { id: string; assigned_user_id: string | null; assigned_assistant_id: string | null },
): Promise<CaseAlertStatus> {
  if (c.assigned_user_id === ctx.user.id || c.assigned_assistant_id === ctx.user.id) return "assigned";
  const { data, error } = await ctx.supabase
    .from("case_followers")
    .select("case_id")
    .eq("case_id", c.id)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) {
    logServerError("getCaseAlertStatus", error);
    return "not_following";
  }
  return data ? "following" : "not_following";
}

/** Opt in to alerts for a case the caller can read. */
export async function followCase(ctx: AuthContext, caseId: string): Promise<ActionResult> {
  const c = await getAuthorizedCase(ctx, caseId);
  if (!c) return fail(ctx.t, "not_found");
  const { error } = await ctx.supabase
    .from("case_followers")
    // organization_id comes from the verified case row, never from the client.
    .insert({ organization_id: c.organization_id, case_id: c.id, user_id: ctx.user.id });
  if (error && error.code !== "23505") {
    // 23505: already following — nothing to do.
    logServerError("followCase", error);
    return fail(ctx.t, classifyDbError(error));
  }
  return { ok: true };
}

export async function unfollowCase(ctx: AuthContext, caseId: string): Promise<ActionResult> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return fail(ctx.t, "validation");
  const { error } = await ctx.supabase.from("case_followers").delete().eq("case_id", id.data).eq("user_id", ctx.user.id);
  if (error) {
    logServerError("unfollowCase", error);
    return fail(ctx.t, classifyDbError(error));
  }
  return { ok: true };
}

export type MyDeadlineRow = Database["public"]["Functions"]["my_upcoming_deadlines"]["Returns"][number];

/** The caller's own confirmed deadlines: overdue, and due within `days`. Always shown; no opt-out. */
export async function getMyUpcomingDeadlines(ctx: AuthContext, days = 7): Promise<MyDeadlineRow[]> {
  if (!ctx.activeOrg) return [];
  const { data, error } = await ctx.supabase.rpc("my_upcoming_deadlines", {
    p_organization_id: ctx.activeOrg.organizationId,
    p_days: days,
  });
  if (error) {
    logServerError("getMyUpcomingDeadlines", error);
    throw new Error("Could not load deadlines");
  }
  return data ?? [];
}
