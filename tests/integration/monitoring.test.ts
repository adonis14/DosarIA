import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { checkCaseForUpdates } from "@/server/monitoring/check-case";
import { MockCourtDataProvider } from "@/server/monitoring/providers/mock-provider";
import type { CourtDataProvider } from "@/server/monitoring/types";
import { contextFor } from "../helpers/context";
import { adminClient, buildWorld, type World } from "../helpers/world";

let w: World;
const mock = new MockCourtDataProvider({ anchorDate: "2026-12-12", now: () => new Date("2026-11-25T09:00:00Z") });

const failing: CourtDataProvider = {
  id: "mock",
  async fetchCase() {
    throw new Error("connection reset");
  },
};
const unavailable: CourtDataProvider = {
  id: "mock",
  async fetchCase() {
    return {
      kind: "unavailable",
      reason: "down",
      source: { provider: "mock", sourceReference: null, fetchedAt: new Date().toISOString(), transport: "mock" },
    };
  },
};

async function freshCase(number: string): Promise<string> {
  const { data, error } = await w.lawyerA1.client
    .from("cases")
    .insert({
      organization_id: w.orgA,
      court_case_number: number,
      court_name: "Tribunalul București",
      title: `Monitorizare ${number}`,
      matter_type: "civil",
      assigned_user_id: w.lawyerA1.id,
      created_by: w.lawyerA1.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

async function caseState(caseId: string) {
  const admin = adminClient();
  const [{ data: c }, { count: snapshots }, { data: events }] = await Promise.all([
    admin.from("cases").select("last_check_outcome, last_successful_check_at, last_check_attempt_at").eq("id", caseId).single(),
    admin.from("case_snapshots").select("id", { count: "exact", head: true }).eq("case_id", caseId).eq("completeness", "complete"),
    admin.from("case_events").select("event_type, summary_ro, summary_en").eq("case_id", caseId).order("detected_at"),
  ]);
  return { c: c!, snapshots: snapshots ?? 0, events: events ?? [] };
}

beforeAll(async () => {
  w = await buildWorld();
});
beforeEach(() => resetRateLimits());

describe("manual monitoring check", () => {
  it("walks the mock timeline: baseline, no change, reschedule, unavailable, incomplete, postponement, decision", async () => {
    const caseId = await freshCase(`${100 + Math.floor(Math.random() * 800)}/3/2026`);
    const ctx = await contextFor(w.lawyerA1.client);
    const run = async () => {
      resetRateLimits();
      const r = await checkCaseForUpdates(ctx, caseId, { provider: mock });
      expect(r.ok).toBe(true);
      return r.ok ? r.data! : null;
    };

    expect((await run())!.outcome).toBe("changes_detected"); // 0: baseline
    expect((await run())!.outcome).toBe("no_changes"); // 1
    const reschedule = await run(); // 2
    expect(reschedule).toMatchObject({ outcome: "changes_detected", eventsCreated: 1 });

    let s = await caseState(caseId);
    const rescheduledEvent = s.events.find((e) => e.event_type === "hearing_rescheduled")!;
    expect(rescheduledEvent.summary_ro).toMatch(/^Termenul de judecată a fost reprogramat\. Termenul anterior era/);
    expect(rescheduledEvent.summary_en).toMatch(/^The court hearing has been rescheduled\./);

    const lastSuccess = s.c.last_successful_check_at;
    expect((await run())!.outcome).toBe("source_unavailable"); // 3
    s = await caseState(caseId);
    expect(s.c.last_check_outcome).toBe("source_unavailable");
    expect(s.c.last_successful_check_at).toBe(lastSuccess);

    expect((await run())!.outcome).toBe("incomplete"); // 4
    s = await caseState(caseId);
    expect(s.c.last_successful_check_at).toBe(lastSuccess);

    expect((await run())!.outcome).toBe("changes_detected"); // 5: postponement
    expect((await run())!.outcome).toBe("changes_detected"); // 6: decision + status
    s = await caseState(caseId);
    expect(s.events.map((e) => e.event_type)).toEqual(
      expect.arrayContaining([
        "monitoring_started",
        "hearing_rescheduled",
        "hearing_postponed",
        "decision_issued",
        "status_changed",
      ]),
    );
    const decision = s.events.find((e) => e.event_type === "decision_issued")!;
    expect(decision.summary_ro).toContain("nu sunt calculate automat");
  });

  it("creates suggested (never confirmed) reminders and flags them for review when the hearing moves", async () => {
    const caseId = await freshCase(`${1000 + Math.floor(Math.random() * 8000)}/3/2026`);
    const ctx = await contextFor(w.lawyerA1.client);
    for (let i = 0; i < 3; i++) {
      resetRateLimits();
      await checkCaseForUpdates(ctx, caseId, { provider: mock });
    }
    const { data: reminders } = await w.lawyerA1.client
      .from("deadline_reminders")
      .select("origin, status, due_date, confirmed_at")
      .eq("case_id", caseId)
      .order("due_date");
    expect(reminders!.length).toBe(2);
    expect(reminders!.every((r) => r.origin === "suggested" && r.confirmed_at === null)).toBe(true);
    // The first suggested hearing date moved → that suggestion needs review.
    expect(reminders![0].status).toBe("needs_review");
    expect(reminders![1].status).toBe("proposed");
  });

  it("deduplicates identical events across concurrent checks", async () => {
    const caseId = await freshCase(`${10000 + Math.floor(Math.random() * 80000)}/3/2026`);
    const ctx = await contextFor(w.lawyerA1.client);
    resetRateLimits();
    await checkCaseForUpdates(ctx, caseId, { provider: mock });
    // Two different users check at the same time with identical source data.
    const adminCtx = await contextFor(w.adminA.client);
    resetRateLimits();
    const sameStep: CourtDataProvider = { id: "mock", fetchCase: (q) => mock.fetchCase({ ...q, attempt: 2 }) };
    const [a, b] = await Promise.all([
      checkCaseForUpdates(ctx, caseId, { provider: sameStep }),
      checkCaseForUpdates(adminCtx, caseId, { provider: sameStep }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const { data } = await adminClient().from("case_events").select("event_type").eq("case_id", caseId).eq("event_type", "hearing_rescheduled");
    expect(data!.length).toBe(1);
  });
});

describe("Scenario H — a failed monitoring run", () => {
  it("preserves the previous valid snapshot and reports failure, not 'no changes'", async () => {
    const caseId = await freshCase(`${200 + Math.floor(Math.random() * 700)}/2/2026`);
    const ctx = await contextFor(w.lawyerA1.client);
    await checkCaseForUpdates(ctx, caseId, { provider: mock });
    const before = await caseState(caseId);
    expect(before.c.last_check_outcome).toBe("changes_detected");
    expect(before.snapshots).toBe(1);

    for (const provider of [failing, unavailable]) {
      resetRateLimits();
      const r = await checkCaseForUpdates(ctx, caseId, { provider });
      expect(r.ok).toBe(true);
      expect(r.ok && r.data!.outcome).not.toBe("no_changes");
      expect(r.ok && ["failed", "source_unavailable"].includes(r.data!.outcome)).toBe(true);

      const after = await caseState(caseId);
      expect(after.snapshots).toBe(1); // previous valid snapshot untouched
      expect(after.c.last_successful_check_at).toBe(before.c.last_successful_check_at);
      expect(after.c.last_check_outcome).not.toBe("no_changes");
      expect(after.events.length).toBe(before.events.length);
    }

    const { data: runs } = await w.lawyerA1.client
      .from("monitoring_runs")
      .select("outcome, error_code")
      .eq("case_id", caseId)
      .order("started_at");
    expect(runs!.map((r) => r.outcome)).toEqual(["changes_detected", "failed", "source_unavailable"]);
    expect(runs![1].error_code).toBe("provider_exception");
  });

  it("treats a malformed payload as failed", async () => {
    const caseId = await freshCase(`9998/${Math.floor(Math.random() * 900) + 1}/2026`);
    const ctx = await contextFor(w.lawyerA1.client);
    const r = await checkCaseForUpdates(ctx, caseId, { provider: mock });
    expect(r.ok && r.data).toMatchObject({ outcome: "failed", errorCode: "invalid_response" });
  });
});

describe("monitoring authorization", () => {
  it("rejects checks on cases the caller cannot access, recording nothing", async () => {
    const ctx = await contextFor(w.lawyerA1.client);
    for (const caseId of [w.caseA2, w.caseB1, "00000000-0000-4000-8000-000000000000", "not-a-uuid"]) {
      resetRateLimits();
      const r = await checkCaseForUpdates(ctx, caseId, { provider: mock });
      expect(r).toMatchObject({ ok: false, code: "not_found" });
    }
    const { count } = await adminClient().from("monitoring_runs").select("id", { count: "exact", head: true }).eq("case_id", w.caseB1);
    expect(count).toBe(1); // only the fixture run
  });

  it("records denied access attempts in the audit log without leaking them to the other tenant", async () => {
    const { data } = await adminClient()
      .from("audit_logs")
      .select("organization_id, actor_user_id")
      .eq("action", "security.case_access_denied")
      .eq("resource_id", w.caseB1);
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((r) => r.organization_id === null && r.actor_user_id === w.lawyerA1.id)).toBe(true);
    const { data: visibleToB } = await w.adminB.client.from("audit_logs").select("id").eq("action", "security.case_access_denied");
    expect(visibleToB).toEqual([]);
  });

  it("rate-limits repeated checks of the same case", async () => {
    resetRateLimits();
    const ctx = await contextFor(w.lawyerA1.client);
    await checkCaseForUpdates(ctx, w.caseA1, { provider: mock });
    const second = await checkCaseForUpdates(ctx, w.caseA1, { provider: mock });
    expect(second).toMatchObject({ ok: false, code: "rate_limited" });
  });
});
