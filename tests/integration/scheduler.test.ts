import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/internal/scheduled-checks/route";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { checkCaseForUpdates } from "@/server/monitoring/check-case";
import { MockCourtDataProvider } from "@/server/monitoring/providers/mock-provider";
import { runDueChecks } from "@/server/monitoring/scheduler";
import { contextFor } from "../helpers/context";
import { adminClient, buildWorld, type World } from "../helpers/world";

let w: World;
const mock = new MockCourtDataProvider({ anchorDate: "2026-12-12", latencyMs: 0 });
const SECRET = "test-scheduler-secret-0123456789-abcdef";
const savedEnv = { enabled: process.env.SCHEDULED_CHECKS_ENABLED, secret: process.env.SCHEDULER_SECRET };

async function freshCase(organizationId: string, client = w.lawyerA1.client, assignee = w.lawyerA1.id): Promise<string> {
  const { data, error } = await client
    .from("cases")
    .insert({
      organization_id: organizationId,
      court_case_number: `${1000 + Math.floor(Math.random() * 90000)}/3/2026`,
      court_name: "Tribunalul București",
      title: "Programare automată (sintetic)",
      matter_type: "civil",
      assigned_user_id: assignee,
      created_by: assignee,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const schedule = async (caseId: string) =>
  (await adminClient().from("case_check_schedule").select("next_check_at, reason, claimed_until").eq("case_id", caseId).maybeSingle()).data;

beforeAll(async () => {
  w = await buildWorld();
});
beforeEach(() => resetRateLimits());
afterAll(() => {
  // Do not leak scheduler settings into other test files.
  if (savedEnv.enabled === undefined) delete process.env.SCHEDULED_CHECKS_ENABLED;
  else process.env.SCHEDULED_CHECKS_ENABLED = savedEnv.enabled;
  if (savedEnv.secret === undefined) delete process.env.SCHEDULER_SECRET;
  else process.env.SCHEDULER_SECRET = savedEnv.secret;
});

describe("check schedule: privileges", () => {
  it("users cannot claim checks or write the schedule", async () => {
    const { error: claimError } = await w.adminA.client.rpc("claim_due_case_checks", { p_limit: 5 });
    expect(claimError?.code).toBe("42501");

    const caseId = await freshCase(w.orgA);
    const { error: insertError } = await w.adminA.client.from("case_check_schedule").insert({
      case_id: caseId,
      organization_id: w.orgA,
      next_check_at: new Date().toISOString(),
      reason: "regular",
    });
    expect(insertError).not.toBeNull();
  });

  it("users read the schedule of cases they can read, and only those", async () => {
    const caseId = await freshCase(w.orgA);
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const r = await checkCaseForUpdates(ctx, caseId, { provider: mock });
    expect(r.ok).toBe(true);

    const own = await w.lawyerA1.client.from("case_check_schedule").select("reason").eq("case_id", caseId);
    expect(own.data).toHaveLength(1);
    const otherTenant = await w.lawyerB1.client.from("case_check_schedule").select("reason").eq("case_id", caseId);
    expect(otherTenant.data).toEqual([]);
    const colleague = await w.lawyerA2.client.from("case_check_schedule").select("reason").eq("case_id", caseId);
    expect(colleague.data).toEqual([]); // not assigned to lawyer A2

    const { error: updateError, count } = await w.lawyerA1.client
      .from("case_check_schedule")
      .update({ next_check_at: "2030-01-01T00:00:00Z" }, { count: "exact" })
      .eq("case_id", caseId);
    expect(updateError !== null || count === 0).toBe(true);
    expect((await schedule(caseId))!.next_check_at).not.toContain("2030");
  });

  it("a scheduled run can never name a triggering user", async () => {
    const caseId = await freshCase(w.orgA);
    const now = new Date().toISOString();
    const { error } = await adminClient().rpc("record_monitoring_run", {
      p_case_id: caseId,
      p_organization_id: w.orgA,
      p_triggered_by: w.lawyerA1.id,
      p_trigger_type: "scheduled",
      p_provider: "mock",
      p_started_at: now,
      p_finished_at: now,
      p_outcome: "failed",
      p_error_code: "provider_exception",
    });
    expect(error?.code).toBe("22023");
  });
});

describe("manual check plans the next automatic check", () => {
  it("stores the plan returned by the check", async () => {
    const caseId = await freshCase(w.orgA);
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const r = await checkCaseForUpdates(ctx, caseId, { provider: mock });
    if (!r.ok) throw new Error("check failed");
    const stored = await schedule(caseId);
    expect(stored).not.toBeNull();
    expect(new Date(stored!.next_check_at).toISOString()).toBe(r.data!.nextCheck.at.toISOString());
    expect(stored!.reason).toBe(r.data!.nextCheck.reason);
    expect(stored!.claimed_until).toBeNull();
    expect(new Date(stored!.next_check_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("scheduler run", () => {
  it("checks the organization's due active cases as system runs, then nothing is due", async () => {
    // A separate firm so only this test's cases are involved.
    const { data: org } = await w.adminA.client.rpc("create_organization", { p_name: `Scheduler Firm ${w.tag}` });
    const orgId = org as string;
    const a = await freshCase(orgId, w.adminA.client, w.adminA.id);
    const b = await freshCase(orgId, w.adminA.client, w.adminA.id);
    const archived = await freshCase(orgId, w.adminA.client, w.adminA.id);
    await w.adminA.client.from("cases").update({ status: "archived" }).eq("id", archived);

    const first = await runDueChecks({ limit: 10, organizationId: orgId, deps: { provider: mock } });
    expect(first).toMatchObject({ status: "ran", claimed: 2, recorded: 2, notSaved: 0, outcomes: { changes_detected: 2 } });

    const { data: runs } = await adminClient()
      .from("monitoring_runs")
      .select("case_id, trigger_type, triggered_by")
      .eq("organization_id", orgId);
    expect(runs).toHaveLength(2);
    for (const run of runs!) {
      expect(run.trigger_type).toBe("scheduled");
      expect(run.triggered_by).toBeNull();
    }
    for (const id of [a, b]) {
      const s = await schedule(id);
      expect(s!.claimed_until).toBeNull(); // lease released
      expect(new Date(s!.next_check_at).getTime()).toBeGreaterThan(Date.now());
    }
    expect(await schedule(archived)).toBeNull(); // archived cases are never checked

    const second = await runDueChecks({ limit: 10, organizationId: orgId, deps: { provider: mock } });
    expect(second).toMatchObject({ status: "ran", claimed: 0 });
  });

  it("a claimed case is leased: a concurrent run does not get it", async () => {
    const { data: org } = await w.adminA.client.rpc("create_organization", { p_name: `Lease Firm ${w.tag}` });
    const orgId = org as string;
    const caseId = await freshCase(orgId, w.adminA.client, w.adminA.id);

    const admin = adminClient();
    const firstClaim = await admin.rpc("claim_due_case_checks", { p_limit: 5, p_lease_seconds: 300, p_organization_id: orgId });
    expect(firstClaim.data?.map((c) => c.case_id)).toEqual([caseId]);
    const secondClaim = await admin.rpc("claim_due_case_checks", { p_limit: 5, p_lease_seconds: 300, p_organization_id: orgId });
    expect(secondClaim.data).toEqual([]);
    expect((await schedule(caseId))!.claimed_until).not.toBeNull();
  });

  it("rejects out-of-range batch sizes", async () => {
    const { error } = await adminClient().rpc("claim_due_case_checks", { p_limit: 1000 });
    expect(error?.code).toBe("22023");
  });
});

describe("scheduler endpoint", () => {
  const call = (auth?: string) =>
    POST(
      new NextRequest("http://localhost:3000/api/internal/scheduled-checks", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      }),
    );

  it("is hidden (404) while automatic checks are disabled", async () => {
    // serverEnv() is read once per test file; this test runs before enabling.
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(404);
  });
});

describe("scheduler endpoint when enabled", () => {
  it("rejects a missing or wrong secret with 401 and no case data", async () => {
    // Fresh module instances so the enabled environment is picked up.
    process.env.SCHEDULED_CHECKS_ENABLED = "true";
    process.env.SCHEDULER_SECRET = SECRET;
    const { vi } = await import("vitest");
    vi.resetModules();
    const route = await import("@/app/api/internal/scheduled-checks/route");
    const req = (auth?: string) =>
      route.POST(
        new NextRequest("http://localhost:3000/api/internal/scheduled-checks", {
          method: "POST",
          headers: auth ? { authorization: auth } : {},
        }),
      );

    for (const auth of [undefined, "Bearer wrong", `Bearer ${SECRET}x`, SECRET]) {
      const res = await req(auth);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("with the right secret runs one batch and returns counts only", async () => {
    process.env.SCHEDULED_CHECKS_ENABLED = "true";
    process.env.SCHEDULER_SECRET = SECRET;
    process.env.SCHEDULER_BATCH_SIZE = "7";
    const { vi } = await import("vitest");
    vi.resetModules();
    // Stand-in for the batch: a real run here would check every due case in the database.
    const calls: { limit: number }[] = [];
    vi.doMock("@/server/monitoring/scheduler", () => ({
      runDueChecks: async (opts: { limit: number }) => {
        calls.push(opts);
        return { status: "ran", claimed: 0, recorded: 0, notSaved: 0, outcomes: {} };
      },
    }));
    try {
      const route = await import("@/app/api/internal/scheduled-checks/route");
      const res = await route.POST(
        new NextRequest("http://localhost:3000/api/internal/scheduled-checks", {
          method: "POST",
          headers: { authorization: `Bearer ${SECRET}` },
        }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ status: "ran", claimed: 0, recorded: 0, notSaved: 0, outcomes: {} });
      expect(calls).toEqual([{ limit: 7 }]);
    } finally {
      vi.doUnmock("@/server/monitoring/scheduler");
      delete process.env.SCHEDULER_BATCH_SIZE;
    }
  });
});
