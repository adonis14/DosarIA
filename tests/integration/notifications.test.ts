import { beforeAll, describe, expect, it } from "vitest";
import { canonicalHash } from "@/server/monitoring/canonical";
import {
  followCase,
  getCaseAlertStatus,
  getMyUpcomingDeadlines,
  getNotificationPreferences,
  getUnreadNotificationCount,
  listNotifications,
  markCaseNotificationsRead,
  markNotificationsRead,
  saveNotificationPreferences,
  unfollowCase,
} from "@/server/dal/notifications";
import type { Json } from "@/lib/supabase/database.types";
import { contextFor } from "../helpers/context";
import { adminClient, anonClient, buildWorld, type Db, type World } from "../helpers/world";

/**
 * Per-person notifications: only the assigned lawyer, the assigned assistant
 * and opted-in followers are told about a case. Everything here uses
 * synthetic fixture data.
 */

let w: World;

beforeAll(async () => {
  w = await buildWorld();
});

type RunOptions = {
  outcome?: "changes_detected" | "failed" | "no_changes";
  events?: Record<string, unknown>[];
};

/** Record a monitoring result the way the trusted process does. */
async function recordRun(caseId: string, organizationId: string, opts: RunOptions = {}) {
  const outcome = opts.outcome ?? "changes_detected";
  const now = new Date().toISOString();
  const data = { label: Math.random().toString(36), hearings: [] };
  const { error } = await adminClient().rpc("record_monitoring_run", {
    p_case_id: caseId,
    p_organization_id: organizationId,
    p_triggered_by: null as unknown as string,
    p_trigger_type: "scheduled",
    p_provider: "mock",
    p_started_at: now,
    p_finished_at: now,
    p_outcome: outcome,
    p_error_code: outcome === "failed" ? "provider_exception" : undefined,
    p_snapshot:
      outcome === "failed"
        ? undefined
        : { source_reference: "mock://test", fetched_at: now, completeness: "complete", content_hash: canonicalHash(data), data },
    p_events: (opts.events ?? []) as Json,
  });
  if (error) throw new Error(`record_monitoring_run: ${error.message}`);
}

function courtEvent(label: string, extra: Record<string, unknown> = {}) {
  return {
    event_type: "status_changed",
    event_key: canonicalHash({ label, r: Math.random() }),
    occurred_on: null,
    details: {},
    summary_ro: `Stadiul s-a schimbat (${label}).`,
    summary_en: `The status changed (${label}).`,
    summary_source: "deterministic_template",
    requires_review: false,
    ...extra,
  };
}

async function freshCase(opts: { assignee?: string; assistant?: string | null } = {}): Promise<string> {
  const { data, error } = await w.adminA.client
    .from("cases")
    .insert({
      organization_id: w.orgA,
      court_case_number: `${1000 + Math.floor(Math.random() * 900000)}/3/2026`,
      court_name: "Tribunalul București",
      title: "Notificări (sintetic)",
      matter_type: "civil",
      assigned_user_id: opts.assignee ?? w.lawyerA1.id,
      assigned_assistant_id: opts.assistant ?? null,
      created_by: w.adminA.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const notificationsOf = async (client: Db, caseId: string) =>
  (await client.from("notifications").select("id, kind, read_at, event_id, reminder_id, check_outcome").eq("case_id", caseId)).data ?? [];

describe("who is notified", () => {
  it("a court event reaches the assigned lawyer and assistant only — not colleagues or admins", async () => {
    // Fixture: caseA2 is lawyer A2's, with assistant A; its first event was recorded at build time.
    const lawyer = await notificationsOf(w.lawyerA2.client, w.caseA2);
    const assistant = await notificationsOf(w.assistantA.client, w.caseA2);
    expect(lawyer).toEqual([expect.objectContaining({ kind: "court_update", event_id: w.eventA2, read_at: null })]);
    expect(assistant).toEqual([expect.objectContaining({ kind: "court_update", event_id: w.eventA2 })]);

    // The admin can read the case but does not follow it: no alerts.
    expect(await notificationsOf(w.adminA.client, w.caseA2)).toEqual([]);
    // A colleague neither reads the case nor gets its alerts.
    expect(await notificationsOf(w.lawyerA1.client, w.caseA2)).toEqual([]);
    // Another firm sees nothing, even by id.
    expect(await notificationsOf(w.lawyerB1.client, w.caseA2)).toEqual([]);
    expect((await adminClient().from("notifications").select("user_id").eq("case_id", w.caseA2)).data).toHaveLength(2);
  });

  it("a follower who can read the case gets its alerts; unfollowing stops them", async () => {
    const caseId = await freshCase();
    const adminCtx = await contextFor(w.adminA.client, w.orgA);
    expect(await getCaseAlertStatus(adminCtx, { id: caseId, assigned_user_id: w.lawyerA1.id, assigned_assistant_id: null })).toBe(
      "not_following",
    );
    expect((await followCase(adminCtx, caseId)).ok).toBe(true);
    expect((await followCase(adminCtx, caseId)).ok).toBe(true); // idempotent
    expect(await getCaseAlertStatus(adminCtx, { id: caseId, assigned_user_id: w.lawyerA1.id, assigned_assistant_id: null })).toBe(
      "following",
    );

    await recordRun(caseId, w.orgA, { events: [courtEvent("follow")] });
    expect((await notificationsOf(w.adminA.client, caseId)).map((n) => n.kind)).toEqual(["court_update"]);
    expect((await notificationsOf(w.lawyerA1.client, caseId)).map((n) => n.kind)).toEqual(["court_update"]);

    expect((await unfollowCase(adminCtx, caseId)).ok).toBe(true);
    await recordRun(caseId, w.orgA, { events: [courtEvent("after unfollow")] });
    expect(await notificationsOf(w.adminA.client, caseId)).toHaveLength(1);
    expect(await notificationsOf(w.lawyerA1.client, caseId)).toHaveLength(2);

    const { data: audit } = await adminClient()
      .from("audit_logs")
      .select("action")
      .eq("resource_id", caseId)
      .in("action", ["case.followed", "case.unfollowed"]);
    expect(audit?.map((a) => a.action).sort()).toEqual(["case.followed", "case.unfollowed"]);
  });

  it("nobody can follow a case they cannot read", async () => {
    // Lawyer A1 cannot read lawyer A2's case.
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    expect((await followCase(ctx, w.caseA2)).ok).toBe(false);
    const { error } = await w.lawyerA1.client
      .from("case_followers")
      .insert({ organization_id: w.orgA, case_id: w.caseA2, user_id: w.lawyerA1.id });
    expect(error).not.toBeNull();
    // Nor follow on someone else's behalf, or across firms.
    const forOther = await w.adminA.client
      .from("case_followers")
      .insert({ organization_id: w.orgA, case_id: w.caseA1, user_id: w.lawyerA2.id });
    expect(forOther.error).not.toBeNull();
    const crossTenant = await w.adminB.client
      .from("case_followers")
      .insert({ organization_id: w.orgA, case_id: w.caseA1, user_id: w.adminB.id });
    expect(crossTenant.error).not.toBeNull();
  });

  it("archived cases notify nobody", async () => {
    const caseId = await freshCase();
    await w.adminA.client.from("cases").update({ status: "archived" }).eq("id", caseId);
    // A direct system write, as monitoring never checks archived cases.
    const { error } = await adminClient()
      .from("case_events")
      .insert({
        organization_id: w.orgA,
        case_id: caseId,
        event_type: "status_changed",
        event_key: canonicalHash({ archived: caseId }),
        summary_ro: "Sintetic.",
        summary_source: "deterministic_template",
      });
    expect(error).toBeNull();
    expect((await adminClient().from("notifications").select("id").eq("case_id", caseId)).data).toEqual([]);
  });
});

describe("what creates a notification", () => {
  it("checks that start failing alert once, not on every retry", async () => {
    const caseId = await freshCase();
    await recordRun(caseId, w.orgA, { outcome: "no_changes" });
    await recordRun(caseId, w.orgA, { outcome: "failed" });
    await recordRun(caseId, w.orgA, { outcome: "failed" });
    const problems = (await notificationsOf(w.lawyerA1.client, caseId)).filter((n) => n.kind === "check_problem");
    expect(problems).toEqual([expect.objectContaining({ check_outcome: "failed" })]);

    // Working again, then failing again: a new alert.
    await recordRun(caseId, w.orgA, { outcome: "no_changes" });
    await recordRun(caseId, w.orgA, { outcome: "failed" });
    expect((await notificationsOf(w.lawyerA1.client, caseId)).filter((n) => n.kind === "check_problem")).toHaveLength(2);
  });

  it("a suggested date and a moved hearing raise deadline alerts", async () => {
    const caseId = await freshCase();
    await recordRun(caseId, w.orgA, {
      events: [
        courtEvent("hearing", {
          event_type: "hearing_scheduled",
          suggested_reminder: { title: "Termen de judecată (sugerat din sursă)", description: null, due_date: "2027-01-15" },
        }),
      ],
    });
    const added = (await notificationsOf(w.lawyerA1.client, caseId)).filter((n) => n.kind === "reminder_added");
    expect(added).toHaveLength(1);

    await recordRun(caseId, w.orgA, {
      events: [courtEvent("moved", { event_type: "hearing_rescheduled", details: { previous_date: "2027-01-15" } })],
    });
    const review = (await notificationsOf(w.lawyerA1.client, caseId)).filter((n) => n.kind === "reminder_needs_review");
    expect(review).toEqual([expect.objectContaining({ reminder_id: added[0].reminder_id })]);
  });

  it("a deadline added by a colleague reaches the lawyer, not the person who added it", async () => {
    const caseId = await freshCase();
    const { error } = await w.adminA.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: caseId, title: "Depunere întâmpinare", due_date: "2027-02-01", created_by: w.adminA.id });
    expect(error).toBeNull();
    expect((await notificationsOf(w.lawyerA1.client, caseId)).map((n) => n.kind)).toContain("reminder_added");
    // Admin A follows nothing here and made the change: no alert either way.
    expect(await notificationsOf(w.adminA.client, caseId)).toEqual([]);
  });

  it("a new assignee is told; the previous lawyer loses the case's alerts with the case", async () => {
    const caseId = await freshCase();
    await recordRun(caseId, w.orgA, { events: [courtEvent("before handover")] });
    expect(await notificationsOf(w.lawyerA1.client, caseId)).toHaveLength(1);

    const { error } = await w.adminA.client.from("cases").update({ assigned_user_id: w.lawyerA2.id }).eq("id", caseId);
    expect(error).toBeNull();
    expect(await notificationsOf(w.lawyerA1.client, caseId)).toEqual([]); // no longer readable
    expect((await notificationsOf(w.lawyerA2.client, caseId)).map((n) => n.kind)).toEqual(["case_assigned"]);
  });
});

describe("personal alert settings", () => {
  it("switching off court updates stops them for that person only; deadline alerts stay on", async () => {
    const caseId = await freshCase({ assistant: w.assistantA.id });
    const lawyerCtx = await contextFor(w.lawyerA1.client, w.orgA);
    expect(await getNotificationPreferences(lawyerCtx)).toEqual({ courtUpdates: true, checkProblems: true });

    expect((await saveNotificationPreferences(lawyerCtx, { checkProblems: "on" })).ok).toBe(true); // insert
    expect(await getNotificationPreferences(lawyerCtx)).toEqual({ courtUpdates: false, checkProblems: true });
    expect((await saveNotificationPreferences(lawyerCtx, { checkProblems: "on" })).ok).toBe(true); // update

    try {
      await recordRun(caseId, w.orgA, {
        events: [
          courtEvent("muted", {
            suggested_reminder: { title: "Termen de judecată (sugerat din sursă)", description: null, due_date: "2027-03-01" },
          }),
        ],
      });
      expect((await notificationsOf(w.lawyerA1.client, caseId)).map((n) => n.kind)).toEqual(["reminder_added"]);
      expect((await notificationsOf(w.assistantA.client, caseId)).map((n) => n.kind).sort()).toEqual([
        "court_update",
        "reminder_added",
      ]);
    } finally {
      await saveNotificationPreferences(lawyerCtx, { courtUpdates: "on", checkProblems: "on" });
    }
  });

  it("settings are personal: nobody can read or write another person's", async () => {
    const { error } = await w.adminA.client
      .from("notification_preferences")
      .insert({ organization_id: w.orgA, user_id: w.lawyerA2.id, court_updates: false, check_problems: false });
    expect(error).not.toBeNull();
    const { data } = await w.adminA.client.from("notification_preferences").select("user_id").eq("user_id", w.lawyerA1.id);
    expect(data).toEqual([]);
  });

  it("rejects unexpected form fields", async () => {
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const r = await saveNotificationPreferences(ctx, { courtUpdates: "on", userId: w.lawyerA2.id });
    expect(r.ok).toBe(false);
  });
});

describe("reading notifications", () => {
  it("users cannot create, delete or rewrite notifications; only mark their own as read", async () => {
    const [mine] = await notificationsOf(w.lawyerA2.client, w.caseA2);
    const ins = await w.lawyerA2.client
      .from("notifications")
      .insert({ organization_id: w.orgA, user_id: w.lawyerA2.id, case_id: w.caseA2, kind: "case_assigned" });
    expect(ins.error).not.toBeNull();

    const rewrite = await w.lawyerA2.client.from("notifications").update({ kind: "case_assigned" } as never).eq("id", mine.id);
    expect(rewrite.error).not.toBeNull();

    const del = await w.lawyerA2.client.from("notifications").delete({ count: "exact" }).eq("id", mine.id);
    expect(del.error !== null || del.count === 0).toBe(true);

    // The assistant's copy cannot be marked read by the lawyer.
    const [theirs] = await notificationsOf(w.assistantA.client, w.caseA2);
    const other = await w.lawyerA2.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() }, { count: "exact" })
      .eq("id", theirs.id);
    expect(other.error !== null || other.count === 0).toBe(true);
    expect((await notificationsOf(w.assistantA.client, w.caseA2))[0].read_at).toBeNull();
  });

  it("marks one, then all, as read with the server's time", async () => {
    const caseId = await freshCase();
    await recordRun(caseId, w.orgA, { events: [courtEvent("one"), courtEvent("two")] });
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const before = await getUnreadNotificationCount(ctx);
    expect(before).toBeGreaterThanOrEqual(2);

    const list = await listNotifications(ctx);
    const target = list.find((n) => n.case_id === caseId && !n.read_at)!;
    expect(target.cases?.title).toBe("Notificări (sintetic)");
    expect(target.case_events?.summary_en).toMatch(/The status changed/);

    // A forged timestamp is replaced by the server's clock.
    await w.lawyerA1.client.from("notifications").update({ read_at: "2099-01-01T00:00:00Z" }).eq("id", target.id);
    const { data: stamped } = await w.lawyerA1.client.from("notifications").select("read_at").eq("id", target.id).single();
    expect(new Date(stamped!.read_at!).getFullYear()).toBe(new Date().getFullYear());
    expect(await getUnreadNotificationCount(ctx)).toBe(before - 1);

    expect((await markNotificationsRead(ctx, { notificationId: "not-a-uuid" })).ok).toBe(false);
    expect((await markNotificationsRead(ctx, {})).ok).toBe(false);
    const all = await markNotificationsRead(ctx, { scope: "all" });
    expect(all.ok).toBe(true);
    expect(await getUnreadNotificationCount(ctx)).toBe(0);
  });

  it("a manual check marks that case's alerts read for the person who ran it", async () => {
    const caseId = await freshCase({ assistant: w.assistantA.id });
    await recordRun(caseId, w.orgA, { events: [courtEvent("seen")] });
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    await markCaseNotificationsRead(ctx, caseId);
    expect((await notificationsOf(w.lawyerA1.client, caseId)).every((n) => n.read_at)).toBe(true);
    expect((await notificationsOf(w.assistantA.client, caseId)).every((n) => n.read_at === null)).toBe(true);
  });
});

describe("anonymous access", () => {
  it("signed-out visitors read nothing and cannot call the deadlines function", async () => {
    const anon = anonClient();
    for (const table of ["notifications", "notification_preferences", "case_followers"] as const) {
      const { data } = await anon.from(table).select("*").limit(1);
      expect(data ?? []).toEqual([]);
    }
    const { error } = await anon.rpc("my_upcoming_deadlines", { p_organization_id: w.orgA });
    expect(error).not.toBeNull();
  });
});

describe("my deadlines", () => {
  it("lists confirmed deadlines due soon on my cases and followed cases only", async () => {
    const caseId = await freshCase();
    const today = new Date().toISOString().slice(0, 10);
    const { data: r } = await w.lawyerA1.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: caseId, title: "Termen apropiat (sintetic)", due_date: today, created_by: w.lawyerA1.id })
      .select("id")
      .single();
    await w.lawyerA1.client.from("deadline_reminders").update({ status: "confirmed" }).eq("id", r!.id);

    const mine = await getMyUpcomingDeadlines(await contextFor(w.lawyerA1.client, w.orgA));
    expect(mine.map((d) => d.id)).toContain(r!.id);

    // The admin can read the case but neither owns nor follows it.
    const adminCtx = await contextFor(w.adminA.client, w.orgA);
    expect((await getMyUpcomingDeadlines(adminCtx)).map((d) => d.id)).not.toContain(r!.id);
    await followCase(adminCtx, caseId);
    expect((await getMyUpcomingDeadlines(adminCtx)).map((d) => d.id)).toContain(r!.id);
    await unfollowCase(adminCtx, caseId);

    // A colleague and another firm never see it.
    expect((await getMyUpcomingDeadlines(await contextFor(w.lawyerA2.client, w.orgA))).map((d) => d.id)).not.toContain(r!.id);
    const { data: cross } = await w.lawyerB1.client.rpc("my_upcoming_deadlines", { p_organization_id: w.orgA, p_days: 60 });
    expect(cross).toEqual([]);
  });
});
