import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@/lib/security/rate-limit";
import type { Json } from "@/lib/supabase/database.types";
import { canonicalHash } from "@/server/monitoring/canonical";
import { checkCaseForUpdates } from "@/server/monitoring/check-case";
import { MockCourtDataProvider } from "@/server/monitoring/providers/mock-provider";
import { followCase, saveNotificationPreferences, unfollowCase } from "@/server/dal/notifications";
import { changeReminderStatus, deleteReminder } from "@/server/dal/reminders";
import {
  changeRulingFollowup,
  countOpenRulingFollowups,
  getCaseRulingFollowups,
  getMyOpenRulingFollowups,
  recordRulingCommunication,
} from "@/server/dal/rulings";
import { bucharestToday } from "@/lib/validation";
import { contextFor } from "../helpers/context";
import { adminClient, buildWorld, type World } from "../helpers/world";

/**
 * Ruling follow-up: a detected ruling opens a task; the responsible lawyer
 * records the communication date and the deadline THEY determined. Nothing is
 * calculated. Synthetic data only.
 */

let w: World;
const RULING_DATE = "2026-11-10"; // in the past, so a communication date can follow it

beforeAll(async () => {
  w = await buildWorld();
});
beforeEach(() => resetRateLimits());

async function freshCase(opts: { assistant?: string | null } = {}): Promise<string> {
  const { data, error } = await w.adminA.client
    .from("cases")
    .insert({
      organization_id: w.orgA,
      court_case_number: `${1000 + Math.floor(Math.random() * 900000)}/3/2026`,
      court_name: "Tribunalul București",
      title: "Hotărâre (sintetic)",
      matter_type: "civil",
      assigned_user_id: w.lawyerA1.id,
      assigned_assistant_id: opts.assistant ?? null,
      created_by: w.adminA.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Record a ruling the way the trusted monitoring process does. */
async function recordRuling(caseId: string, eventType: "decision_issued" | "status_changed" = "decision_issued") {
  const now = new Date().toISOString();
  const data = { label: Math.random().toString(36), hearings: [] };
  const { error } = await adminClient().rpc("record_monitoring_run", {
    p_case_id: caseId,
    p_organization_id: w.orgA,
    p_triggered_by: null as unknown as string,
    p_trigger_type: "scheduled",
    p_provider: "mock",
    p_started_at: now,
    p_finished_at: now,
    p_outcome: "changes_detected",
    p_snapshot: { source_reference: "mock://test", fetched_at: now, completeness: "complete", content_hash: canonicalHash(data), data },
    p_events: [
      {
        event_type: eventType,
        event_key: canonicalHash({ caseId, r: Math.random() }),
        occurred_on: RULING_DATE,
        details: { hearing_date: RULING_DATE, solution_text: "Admite cererea.", document_reference: null },
        summary_ro: "A fost pronunțată o hotărâre (sintetic).",
        summary_en: "A ruling was issued (synthetic).",
        summary_source: "deterministic_template",
        requires_review: false,
      },
    ] as Json,
  });
  if (error) throw new Error(`record_monitoring_run: ${error.message}`);
  const { data: f } = await adminClient().from("ruling_followups").select("id, event_id, status").eq("case_id", caseId).maybeSingle();
  return f;
}

describe("a detected ruling opens a task", () => {
  it("only rulings open one, and the real monitoring pipeline does too", async () => {
    const plain = await freshCase();
    expect(await recordRuling(plain, "status_changed")).toBeNull();

    const caseId = await freshCase();
    expect(await recordRuling(caseId)).toMatchObject({ status: "awaiting_communication" });

    // Through checkCaseForUpdates and the simulated timeline (attempt 6 is a ruling).
    const timeline = await freshCase();
    const mock = new MockCourtDataProvider({ anchorDate: "2026-12-12", now: () => new Date("2026-11-25T09:00:00Z") });
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    for (let i = 0; i < 7; i++) {
      resetRateLimits();
      expect((await checkCaseForUpdates(ctx, timeline, { provider: mock })).ok).toBe(true);
    }
    const tasks = await getCaseRulingFollowups(ctx, timeline);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("awaiting_communication");
    expect(tasks[0].case_events?.details.solution_text).toBeTruthy();
  });

  it("ruling alerts reach the lawyer even with court updates switched off", async () => {
    const lawyerCtx = await contextFor(w.lawyerA1.client, w.orgA);
    await saveNotificationPreferences(lawyerCtx, {}); // both switched off
    try {
      const caseId = await freshCase();
      await recordRuling(caseId);
      const { data } = await w.lawyerA1.client.from("notifications").select("kind").eq("case_id", caseId);
      expect(data?.map((n) => n.kind)).toEqual(["court_update"]);

      const other = await freshCase();
      await recordRuling(other, "status_changed");
      const { data: none } = await w.lawyerA1.client.from("notifications").select("kind").eq("case_id", other);
      expect(none).toEqual([]);
    } finally {
      await saveNotificationPreferences(lawyerCtx, { courtUpdates: "on", checkProblems: "on" });
    }
  });
});

describe("recording the communication date", () => {
  it("the lawyer's own deadline is created as proposed, then confirmed as usual", async () => {
    const caseId = await freshCase();
    const f = (await recordRuling(caseId))!;
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);

    const r = await recordRulingCommunication(ctx, {
      followupId: f.id,
      communicatedOn: "2026-11-20",
      deadlineDate: "2026-12-10",
      title: "Termen apel (stabilit de avocat)",
    });
    if (!r.ok) throw new Error(r.error);

    const [task] = await getCaseRulingFollowups(ctx, caseId);
    expect(task).toMatchObject({ status: "recorded", communicated_on: "2026-11-20", resolved_by: w.lawyerA1.id });
    expect(task.deadline_reminders).toMatchObject({ due_date: "2026-12-10", status: "proposed" });

    const { data: reminder } = await w.lawyerA1.client
      .from("deadline_reminders")
      .select("origin, status, source_event_id, created_by")
      .eq("id", r.data!.reminderId)
      .single();
    expect(reminder).toEqual({ origin: "manual", status: "proposed", source_event_id: f.event_id, created_by: w.lawyerA1.id });

    expect((await changeReminderStatus(ctx, { reminderId: r.data!.reminderId, action: "confirm" })).ok).toBe(true);

    // Already handled: a second recording is refused.
    const again = await recordRulingCommunication(ctx, {
      followupId: f.id,
      communicatedOn: "2026-11-21",
      deadlineDate: "2026-12-11",
      title: "Din nou",
    });
    expect(again.ok).toBe(false);

    const { data: audit } = await adminClient()
      .from("audit_logs")
      .select("action")
      .eq("resource_id", caseId)
      .like("action", "ruling_followup.%");
    expect(audit?.map((a) => a.action).sort()).toEqual(["ruling_followup.opened", "ruling_followup.status_changed"]);
  });

  it("rejects impossible dates, in the app and in the database", async () => {
    const caseId = await freshCase();
    const f = (await recordRuling(caseId))!;
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const tomorrow = new Date(Date.parse(`${bucharestToday()}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const base = { followupId: f.id, title: "Termen apel" };

    const future = await recordRulingCommunication(ctx, { ...base, communicatedOn: tomorrow, deadlineDate: tomorrow });
    expect(future.ok === false && future.fieldErrors?.communicatedOn).toBeTruthy();
    const backwards = await recordRulingCommunication(ctx, { ...base, communicatedOn: "2026-11-20", deadlineDate: "2026-11-19" });
    expect(backwards.ok === false && backwards.fieldErrors?.deadlineDate).toBeTruthy();
    const beforeRuling = await recordRulingCommunication(ctx, { ...base, communicatedOn: "2026-11-01", deadlineDate: "2026-11-30" });
    expect(beforeRuling.ok).toBe(false);

    // The same rules hold when the database function is called directly.
    for (const [communicated, deadline] of [
      [tomorrow, tomorrow],
      ["2026-11-20", "2026-11-19"],
      ["2026-11-01", "2026-11-30"],
    ]) {
      const { error } = await w.lawyerA1.client.rpc("record_ruling_communication", {
        p_followup_id: f.id,
        p_communicated_on: communicated,
        p_deadline_date: deadline,
        p_deadline_title: "Termen apel",
      });
      expect(error?.code).toBe("23514");
    }
    expect((await getCaseRulingFollowups(ctx, caseId))[0].status).toBe("awaiting_communication");
    // Nothing half-written: no deadline was left behind.
    const { data: reminders } = await adminClient().from("deadline_reminders").select("id").eq("case_id", caseId);
    expect(reminders).toEqual([]);
  });

  it("deleting the proposed deadline reopens the task", async () => {
    const caseId = await freshCase();
    const f = (await recordRuling(caseId))!;
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const r = await recordRulingCommunication(ctx, {
      followupId: f.id,
      communicatedOn: "2026-11-20",
      deadlineDate: "2026-12-10",
      title: "Termen apel",
    });
    expect(r.ok).toBe(true);
    expect((await deleteReminder(ctx, r.ok ? r.data!.reminderId : "")).ok).toBe(true);
    const [task] = await getCaseRulingFollowups(ctx, caseId);
    expect(task).toMatchObject({ status: "awaiting_communication", resolved_by: null, resolved_at: null });
  });

  it("'no deadline to track' and reopening; no other transitions", async () => {
    const caseId = await freshCase();
    const f = (await recordRuling(caseId))!;
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);

    expect((await changeRulingFollowup(ctx, { followupId: f.id, action: "not_needed", note: "Hotărâre definitivă" })).ok).toBe(true);
    let [task] = await getCaseRulingFollowups(ctx, caseId);
    expect(task).toMatchObject({ status: "not_needed", note: "Hotărâre definitivă", resolved_by: w.lawyerA1.id });

    expect((await changeRulingFollowup(ctx, { followupId: f.id, action: "reopen" })).ok).toBe(true);
    [task] = await getCaseRulingFollowups(ctx, caseId);
    expect(task).toMatchObject({ status: "awaiting_communication", note: null, resolved_at: null });

    // "recorded" needs both dates and a deadline of this ruling.
    const direct = await w.lawyerA1.client.from("ruling_followups").update({ status: "recorded" }).eq("id", f.id);
    expect(direct.error).not.toBeNull();
    const { data: unrelated } = await w.lawyerA1.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: caseId, title: "Alt termen", due_date: "2026-12-01", created_by: w.lawyerA1.id })
      .select("id")
      .single();
    const wrongLink = await w.lawyerA1.client
      .from("ruling_followups")
      .update({ status: "recorded", communicated_on: "2026-11-20", reminder_id: unrelated!.id })
      .eq("id", f.id);
    expect(wrongLink.error?.code).toBe("23514");
  });
});

describe("who may do what", () => {
  it("the assistant sees the task but cannot resolve it; colleagues and other firms do not see it", async () => {
    const caseId = await freshCase({ assistant: w.assistantA.id });
    const f = (await recordRuling(caseId))!;

    const assistantCtx = await contextFor(w.assistantA.client, w.orgA);
    expect(await getCaseRulingFollowups(assistantCtx, caseId)).toHaveLength(1);
    const r = await recordRulingCommunication(assistantCtx, {
      followupId: f.id,
      communicatedOn: "2026-11-20",
      deadlineDate: "2026-12-10",
      title: "Termen apel",
    });
    expect(r.ok === false && r.code).toBe("forbidden");
    const { error } = await w.assistantA.client.rpc("record_ruling_communication", {
      p_followup_id: f.id,
      p_communicated_on: "2026-11-20",
      p_deadline_date: "2026-12-10",
      p_deadline_title: "Termen apel",
    });
    expect(error).not.toBeNull();
    const update = await w.assistantA.client
      .from("ruling_followups")
      .update({ status: "not_needed" }, { count: "exact" })
      .eq("id", f.id);
    expect(update.error !== null || update.count === 0).toBe(true);

    for (const client of [w.lawyerA2.client, w.lawyerB1.client]) {
      const { data } = await client.from("ruling_followups").select("id").eq("id", f.id);
      expect(data).toEqual([]);
      const { error: rpcError } = await client.rpc("record_ruling_communication", {
        p_followup_id: f.id,
        p_communicated_on: "2026-11-20",
        p_deadline_date: "2026-12-10",
        p_deadline_title: "Termen apel",
      });
      expect(rpcError?.code).toBe("P0002"); // same answer as "does not exist"
    }
    expect((await adminClient().from("ruling_followups").select("status").eq("id", f.id).single()).data?.status).toBe(
      "awaiting_communication",
    );
  });

  it("users cannot create, delete or rewrite tasks", async () => {
    const caseId = await freshCase();
    const f = (await recordRuling(caseId))!;
    const ins = await w.adminA.client
      .from("ruling_followups")
      .insert({ organization_id: w.orgA, case_id: caseId, event_id: f.event_id } as never);
    expect(ins.error).not.toBeNull();
    const del = await w.adminA.client.from("ruling_followups").delete({ count: "exact" }).eq("id", f.id);
    expect(del.error !== null || del.count === 0).toBe(true);
    const forge = await w.adminA.client
      .from("ruling_followups")
      .update({ resolved_by: w.lawyerA2.id } as never)
      .eq("id", f.id);
    expect(forge.error).not.toBeNull();
  });

  it("open tasks: mine on the Notifications page, the firm's count for the admin", async () => {
    const caseId = await freshCase();
    const f = (await recordRuling(caseId))!;

    const mine = await getMyOpenRulingFollowups(await contextFor(w.lawyerA1.client, w.orgA));
    expect(mine.map((t) => t.id)).toContain(f.id);
    expect(mine.find((t) => t.id === f.id)).toMatchObject({ ruling_date: RULING_DATE, case_id: caseId });

    const adminCtx = await contextFor(w.adminA.client, w.orgA);
    expect((await getMyOpenRulingFollowups(adminCtx)).map((t) => t.id)).not.toContain(f.id);
    await followCase(adminCtx, caseId);
    expect((await getMyOpenRulingFollowups(adminCtx)).map((t) => t.id)).toContain(f.id);
    await unfollowCase(adminCtx, caseId);
    expect(await countOpenRulingFollowups(adminCtx)).toBeGreaterThanOrEqual(1);

    expect((await getMyOpenRulingFollowups(await contextFor(w.lawyerA2.client, w.orgA))).map((t) => t.id)).not.toContain(f.id);
    const { data: cross } = await w.lawyerB1.client.rpc("my_open_ruling_followups", { p_organization_id: w.orgA });
    expect(cross).toEqual([]);
  });
});
