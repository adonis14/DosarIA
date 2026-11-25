import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, buildWorld, type World } from "../helpers/world";

/**
 * Direct database tests: real signed-in users talk to PostgREST with their
 * own JWT, exactly like an attacker with a valid account would. Nothing here
 * goes through the Next.js app, so these prove the DATABASE enforces
 * isolation even if application code were bypassed.
 */

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});

const admin = () => adminClient();

describe("Scenario A — cross-tenant isolation (Org A user vs Org B data)", () => {
  it("cannot list Organization B cases", async () => {
    for (const p of [w.adminA, w.lawyerA1]) {
      const { data, error } = await p.client.from("cases").select("id, organization_id");
      expect(error).toBeNull();
      expect(data!.some((c) => c.organization_id === w.orgB)).toBe(false);
      const { data: filtered } = await p.client.from("cases").select("id").eq("organization_id", w.orgB);
      expect(filtered).toEqual([]);
    }
  });

  it("cannot read Organization B case details by id", async () => {
    const { data } = await w.adminA.client.from("cases").select("*").eq("id", w.caseB1).maybeSingle();
    expect(data).toBeNull();
  });

  it("cannot edit Organization B records", async () => {
    const { data } = await w.adminA.client.from("cases").update({ title: "hijacked" }).eq("id", w.caseB1).select("id");
    expect(data ?? []).toEqual([]);
    const { data: rem } = await w.adminA.client.from("deadline_reminders").update({ title: "hijacked" }).eq("id", w.reminderB1).select("id");
    expect(rem ?? []).toEqual([]);
    const { data: org } = await w.adminA.client.from("organizations").update({ name: "hijacked" }).eq("id", w.orgB).select("id");
    expect(org ?? []).toEqual([]);
    const { data: del } = await w.adminA.client.from("deadline_reminders").delete().eq("id", w.reminderB1).select("id");
    expect(del ?? []).toEqual([]);

    const { data: still } = await admin().from("cases").select("title").eq("id", w.caseB1).single();
    expect(still!.title).toBe("Contestație la executare (B1)");
    const { count } = await admin().from("deadline_reminders").select("id", { count: "exact", head: true }).eq("id", w.reminderB1);
    expect(count).toBe(1);
  });

  it("cannot read Organization B events, snapshots or monitoring runs", async () => {
    for (const table of ["case_events", "case_snapshots", "monitoring_runs"] as const) {
      const { data } = await w.adminA.client.from(table).select("id").eq("case_id", w.caseB1);
      expect(data, table).toEqual([]);
      const { data: byOrg } = await w.adminA.client.from(table).select("id").eq("organization_id", w.orgB);
      expect(byOrg, table).toEqual([]);
    }
  });

  it("cannot view Organization B reminders", async () => {
    const { data } = await w.lawyerA1.client.from("deadline_reminders").select("id").eq("id", w.reminderB1);
    expect(data).toEqual([]);
  });

  it("cannot see Organization B members, invitations, profiles or audit log", async () => {
    const { data: members } = await w.adminA.client.from("organization_memberships").select("id").eq("organization_id", w.orgB);
    expect(members).toEqual([]);
    const { data: org } = await w.adminA.client.from("organizations").select("id").eq("id", w.orgB);
    expect(org).toEqual([]);
    const { data: profile } = await w.adminA.client.from("profiles").select("id").eq("id", w.lawyerB1.id);
    expect(profile).toEqual([]);
    const { data: audit } = await w.adminA.client.from("audit_logs").select("id").eq("organization_id", w.orgB);
    expect(audit).toEqual([]);
    const { data: inv } = await w.adminA.client.from("organization_invitations").select("id").eq("organization_id", w.orgB);
    expect(inv).toEqual([]);
  });

  it("cannot retrieve Organization B private files (file storage is not exposed in the MVP)", async () => {
    // Storage is disabled in this MVP: there is no bucket, endpoint or object to retrieve.
    const { data, error } = await w.adminA.client.storage.from("case-files").download(`${w.orgB}/${w.caseB1}/document.pdf`);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe("Scenario B — cross-user isolation inside one organization", () => {
  it("Lawyer A1 cannot read Lawyer A2's case or its child records", async () => {
    const c = w.lawyerA1.client;
    expect((await c.from("cases").select("id").eq("id", w.caseA2)).data).toEqual([]);
    expect((await c.from("case_events").select("id").eq("case_id", w.caseA2)).data).toEqual([]);
    expect((await c.from("case_snapshots").select("id").eq("case_id", w.caseA2)).data).toEqual([]);
    expect((await c.from("monitoring_runs").select("id").eq("case_id", w.caseA2)).data).toEqual([]);
    const { data: all } = await c.from("cases").select("id");
    expect(all!.map((r) => r.id)).toEqual([w.caseA1]);
  });

  it("Lawyer A1 cannot update Lawyer A2's case", async () => {
    const { data } = await w.lawyerA1.client.from("cases").update({ title: "taken" }).eq("id", w.caseA2).select("id");
    expect(data ?? []).toEqual([]);
  });

  it("Organization A's admin can read both lawyers' cases", async () => {
    const { data } = await w.adminA.client.from("cases").select("id").in("id", [w.caseA1, w.caseA2]);
    expect(data!.map((r) => r.id).sort()).toEqual([w.caseA1, w.caseA2].sort());
    const { data: events } = await w.adminA.client.from("case_events").select("id").in("case_id", [w.caseA1, w.caseA2]);
    expect(events!.length).toBe(2);
  });

  it("the assistant reads only the case assigned to them, and cannot write", async () => {
    const c = w.assistantA.client;
    expect((await c.from("cases").select("id")).data!.map((r) => r.id)).toEqual([w.caseA2]);
    expect((await c.from("case_events").select("id").eq("case_id", w.caseA2)).data!.length).toBe(1);
    const { data: upd } = await c.from("cases").update({ title: "x" }).eq("id", w.caseA2).select("id");
    expect(upd ?? []).toEqual([]);
    const { error } = await c
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: w.caseA2, title: "Nu", due_date: "2026-12-20", created_by: w.assistantA.id });
    expect(error?.code).toBe("42501");
  });

  it("a suspended member loses access immediately", async () => {
    const { data: m } = await admin()
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", w.orgA)
      .eq("user_id", w.lawyerA2.id)
      .single();
    await admin().from("organization_memberships").update({ status: "suspended" }).eq("id", m!.id);
    try {
      expect((await w.lawyerA2.client.from("cases").select("id")).data).toEqual([]);
    } finally {
      await admin().from("organization_memberships").update({ status: "active" }).eq("id", m!.id);
    }
    expect((await w.lawyerA2.client.from("cases").select("id")).data!.map((r) => r.id)).toEqual([w.caseA2]);
  });
});

describe("Scenario C — a lawyer cannot escalate their role", () => {
  it("updating own membership role to admin fails and the role is unchanged", async () => {
    const { data, error } = await w.lawyerA1.client
      .from("organization_memberships")
      .update({ role: "admin" })
      .eq("id", w.membershipA1)
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    const { data: m } = await admin().from("organization_memberships").select("role").eq("id", w.membershipA1).single();
    expect(m!.role).toBe("lawyer");
  });

  it("cannot insert a membership (in any organization)", async () => {
    for (const org of [w.orgA, w.orgB]) {
      const { error } = await w.lawyerA1.client
        .from("organization_memberships")
        .insert({ organization_id: org, user_id: w.lawyerA1.id, role: "admin" });
      expect(error?.code).toBe("42501");
    }
  });

  it("an admin cannot change their own role (and no-one can remove the last admin)", async () => {
    const { data: own } = await admin()
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", w.orgA)
      .eq("user_id", w.adminA.id)
      .single();
    const { error } = await w.adminA.client.from("organization_memberships").update({ role: "lawyer" }).eq("id", own!.id);
    expect(error?.code).toBe("42501");
    const { error: lastAdmin } = await admin().from("organization_memberships").update({ role: "lawyer" }).eq("id", own!.id);
    expect(lastAdmin?.code).toBe("23514");
  });

  it("cannot change membership organization or user, even as admin", async () => {
    const { error } = await w.adminA.client
      .from("organization_memberships")
      .update({ organization_id: w.orgB } as never)
      .eq("id", w.membershipA1);
    expect(error?.code).toBe("42501");
  });

  it("JWT user metadata is not an authority: writing role=admin into it grants nothing", async () => {
    await w.lawyerA1.client.auth.updateUser({ data: { role: "admin", organization_id: w.orgB } });
    const { data } = await w.lawyerA1.client.from("cases").select("id");
    expect(data!.map((r) => r.id)).toEqual([w.caseA1]);
  });

  it("cannot call privileged RPCs", async () => {
    const { error } = await w.lawyerA1.client.rpc("record_monitoring_run", {
      p_case_id: w.caseA2,
      p_organization_id: w.orgA,
      p_triggered_by: w.lawyerA1.id,
      p_trigger_type: "manual",
      p_provider: "mock",
      p_started_at: new Date().toISOString(),
      p_finished_at: new Date().toISOString(),
      p_outcome: "no_changes",
    });
    expect(error).not.toBeNull();
    const { error: forged } = await w.lawyerA1.client.from("case_events").insert({
      organization_id: w.orgA,
      case_id: w.caseA1,
      event_type: "decision_issued",
      event_key: "f".repeat(64),
      summary_ro: "forged",
      summary_source: "llm",
    });
    expect(forged?.code).toBe("42501");
  });
});

describe("Scenario D — substituting another organization's UUID", () => {
  it("cannot create a case in Organization B", async () => {
    const { error } = await w.lawyerA1.client.from("cases").insert({
      organization_id: w.orgB,
      court_case_number: "1/1/2026",
      court_name: "Tribunalul Cluj",
      title: "Injected",
      matter_type: "civil",
      assigned_user_id: w.lawyerA1.id,
      created_by: w.lawyerA1.id,
    });
    expect(error?.code).toBe("42501");
  });

  it("cannot create a reminder, invitation or rename under Organization B", async () => {
    const { error: r } = await w.adminA.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgB, case_id: w.caseB1, title: "Injected", due_date: "2026-12-20", created_by: w.adminA.id });
    expect(r?.code).toBe("42501");
    const { error: i } = await w.adminA.client.from("organization_invitations").insert({
      organization_id: w.orgB,
      email: "intruder@example.com",
      role: "admin",
      token_hash: "a".repeat(64),
      invited_by: w.adminA.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(i?.code).toBe("42501");
  });

  it("a lawyer cannot create a case assigned to someone else", async () => {
    const { error } = await w.lawyerA1.client.from("cases").insert({
      organization_id: w.orgA,
      court_case_number: "2/1/2026",
      court_name: "Tribunalul București",
      title: "Assigned to A2",
      matter_type: "civil",
      assigned_user_id: w.lawyerA2.id,
      created_by: w.lawyerA1.id,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("Scenario E — protected columns cannot be changed", () => {
  it("a lawyer cannot change organization_id of their own case", async () => {
    const { error } = await w.lawyerA1.client
      .from("cases")
      .update({ organization_id: w.orgB } as never)
      .eq("id", w.caseA1);
    expect(error?.code).toBe("42501");
  });

  it("an admin cannot move a case to another organization either", async () => {
    const { error } = await w.adminA.client
      .from("cases")
      .update({ organization_id: w.orgB } as never)
      .eq("id", w.caseA1);
    expect(error?.code).toBe("42501");
  });

  it("a lawyer cannot reassign or unassign their case", async () => {
    for (const assigned of [w.lawyerA2.id, null]) {
      const { data, error } = await w.lawyerA1.client
        .from("cases")
        .update({ assigned_user_id: assigned })
        .eq("id", w.caseA1)
        .select("id");
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    const { data } = await admin().from("cases").select("assigned_user_id, organization_id").eq("id", w.caseA1).single();
    expect(data).toEqual({ assigned_user_id: w.lawyerA1.id, organization_id: w.orgA });
  });

  it("users cannot write monitoring state or provenance columns", async () => {
    for (const patch of [
      { last_check_outcome: "no_changes" },
      { last_successful_check_at: new Date().toISOString() },
      { created_by: w.lawyerA2.id },
      { court_status: "Soluționat" },
    ]) {
      const { error } = await w.adminA.client.from("cases").update(patch as never).eq("id", w.caseA1);
      expect(error?.code, JSON.stringify(patch)).toBe("42501");
    }
  });

  it("confirmation metadata cannot be forged", async () => {
    const { error } = await w.lawyerA1.client
      .from("deadline_reminders")
      .update({ confirmed_by: w.adminA.id, confirmed_at: new Date().toISOString() } as never)
      .eq("id", w.reminderA1);
    expect(error?.code).toBe("42501");
  });

  it("an admin can reassign within the org, but never to a member of another org", async () => {
    const { error: cross } = await w.adminA.client.from("cases").update({ assigned_user_id: w.lawyerB1.id }).eq("id", w.caseA1);
    // Rejected by guard_cases (assignee must be an ACTIVE member of THIS org) before the
    // composite FK (organization_id, assigned_user_id) → memberships is even evaluated.
    expect(cross?.code).toBe("23514");
    const { error: ok } = await w.adminA.client.from("cases").update({ assigned_user_id: w.lawyerA1.id }).eq("id", w.caseA1);
    expect(ok).toBeNull();
  });

  it("an assistant cannot be made responsible lawyer", async () => {
    const { error } = await w.adminA.client.from("cases").update({ assigned_user_id: w.assistantA.id }).eq("id", w.caseA1);
    expect(error?.code).toBe("23514");
  });
});

describe("Scenario F — unauthenticated access", () => {
  it("anonymous requests get no private data", async () => {
    const anon = anonClient();
    for (const table of [
      "cases",
      "case_events",
      "case_snapshots",
      "deadline_reminders",
      "monitoring_runs",
      "organizations",
      "organization_memberships",
      "organization_invitations",
      "profiles",
      "audit_logs",
    ] as const) {
      const { data, error } = await anon.from(table).select("*").limit(5);
      // Either a permission error or an empty result; never rows.
      expect(error !== null || (data ?? []).length === 0, table).toBe(true);
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("anonymous requests cannot call RPCs", async () => {
    const anon = anonClient();
    expect((await anon.rpc("create_organization", { p_name: "Anon firm" })).error).not.toBeNull();
    expect((await anon.rpc("accept_invitation", { p_token: "a".repeat(43) })).error).not.toBeNull();
  });
});

describe("Scenario G — cross-organization associations are rejected by the database", () => {
  it("an event referencing another organization's case is rejected, even for the privileged role", async () => {
    const { error } = await admin().from("case_events").insert({
      organization_id: w.orgA,
      case_id: w.caseB1,
      event_type: "status_changed",
      event_key: "e".repeat(64),
      summary_ro: "cross-org",
      summary_source: "deterministic_template",
    });
    expect(error?.code).toBe("23503");
  });

  it("a reminder referencing another organization's case is rejected, even for the privileged role", async () => {
    const { error } = await admin()
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: w.caseB1, title: "cross-org", due_date: "2026-12-20" });
    expect(error?.code).toBe("23503");
  });

  it("a reminder citing an event from a different case is rejected", async () => {
    const { error } = await admin()
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: w.caseA1, source_event_id: w.eventA2, title: "wrong event", due_date: "2026-12-20" });
    expect(error?.code).toBe("23503");
  });

  it("snapshots and monitoring runs cannot be cross-linked", async () => {
    const { error: s } = await admin().from("case_snapshots").insert({
      organization_id: w.orgB,
      case_id: w.caseA1,
      provider: "mock",
      fetched_at: new Date().toISOString(),
      completeness: "complete",
      content_hash: "c".repeat(64),
      data: {},
    });
    expect(s?.code).toBe("23503");
    const { error: rpc } = await admin().rpc("record_monitoring_run", {
      p_case_id: w.caseB1,
      p_organization_id: w.orgA,
      p_triggered_by: w.lawyerA1.id,
      p_trigger_type: "manual",
      p_provider: "mock",
      p_started_at: new Date().toISOString(),
      p_finished_at: new Date().toISOString(),
      p_outcome: "no_changes",
    });
    expect(rpc?.code).toBe("P0002");
  });

  it("a user of Org A inserting a reminder for Org B's case under Org A's id is rejected", async () => {
    const { error } = await w.adminA.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: w.caseB1, title: "cross-org", due_date: "2026-12-20", created_by: w.adminA.id });
    expect(error?.code === "42501" || error?.code === "23503").toBe(true);
  });
});

describe("account deletion (GDPR erasure of a user)", () => {
  it("deleting an assigned user nulls their references without bypassing tenant boundaries", async () => {
    const { createConfirmedUser, signIn } = await import("../helpers/world");
    const email = `leaver.${w.tag}@example.com`;
    const leaverId = await createConfirmedUser(email, "Plecat (sintetic)");
    await admin().from("organization_memberships").insert({ organization_id: w.orgA, user_id: leaverId, role: "lawyer" });
    const leaver = await signIn(email);
    const { data: c } = await leaver
      .from("cases")
      .insert({
        organization_id: w.orgA,
        court_case_number: "777/3/2026",
        court_name: "Tribunalul București",
        title: "Dosar coleg plecat",
        matter_type: "civil",
        assigned_user_id: leaverId,
        created_by: leaverId,
      })
      .select("id")
      .single();

    const { error } = await admin().auth.admin.deleteUser(leaverId);
    expect(error).toBeNull();
    const { data: after } = await admin().from("cases").select("organization_id, assigned_user_id, created_by").eq("id", c!.id).single();
    expect(after).toEqual({ organization_id: w.orgA, assigned_user_id: null, created_by: null });
  });
});

describe("Audit trail protection", () => {
  it("admins can read their own org's audit log; it records security-relevant events", async () => {
    const { data } = await w.adminA.client.from("audit_logs").select("action").eq("organization_id", w.orgA);
    const actions = new Set(data!.map((r) => r.action));
    for (const a of ["organization.created", "member.added", "case.created", "reminder.created", "monitoring.run_completed"]) {
      expect(actions.has(a), a).toBe(true);
    }
  });

  it("lawyers cannot read the audit log", async () => {
    const { data } = await w.lawyerA1.client.from("audit_logs").select("id");
    expect(data).toEqual([]);
  });

  it("nobody can modify or delete audit entries — not even the service role", async () => {
    const { data: row } = await admin().from("audit_logs").select("id").eq("organization_id", w.orgA).limit(1).single();
    const { error: upd } = await admin().from("audit_logs").update({ action: "tampered.entry" }).eq("id", row!.id);
    expect(upd).not.toBeNull();
    const { error: del } = await admin().from("audit_logs").delete().eq("id", row!.id);
    expect(del).not.toBeNull();
    const { error: userDel } = await w.adminA.client.from("audit_logs").delete().eq("id", row!.id);
    expect(userDel).not.toBeNull();
  });

  it("audit metadata contains no invitee emails", async () => {
    await w.adminA.client.from("organization_invitations").insert({
      organization_id: w.orgA,
      email: `invitee.${w.tag}@example.com`,
      role: "lawyer",
      token_hash: "b".repeat(63) + "1",
      invited_by: w.adminA.id,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    const { data } = await admin().from("audit_logs").select("metadata").eq("organization_id", w.orgA);
    expect(JSON.stringify(data)).not.toContain(`invitee.${w.tag}`);
  });
});

describe("interface language preference (profiles.preferred_locale)", () => {
  it("a user can set their own language to en or ro", async () => {
    for (const locale of ["ro", "en"]) {
      const { data, error } = await w.lawyerA1.client
        .from("profiles")
        .update({ preferred_locale: locale })
        .eq("id", w.lawyerA1.id)
        .select("preferred_locale");
      expect(error).toBeNull();
      expect(data).toEqual([{ preferred_locale: locale }]);
    }
  });

  it("only supported languages are accepted", async () => {
    const { error } = await w.lawyerA1.client.from("profiles").update({ preferred_locale: "de" }).eq("id", w.lawyerA1.id);
    expect(error?.code).toBe("23514");
  });

  it("nobody can change a colleague's language, not even an admin", async () => {
    await admin().from("profiles").update({ preferred_locale: "en" }).eq("id", w.lawyerA2.id);
    for (const actor of [w.lawyerA1, w.adminA]) {
      const { data } = await actor.client
        .from("profiles")
        .update({ preferred_locale: "ro" })
        .eq("id", w.lawyerA2.id)
        .select("id");
      expect(data ?? []).toEqual([]);
    }
    const { data } = await admin().from("profiles").select("preferred_locale").eq("id", w.lawyerA2.id).single();
    expect(data!.preferred_locale).toBe("en");
  });

  it("the new column grant does not open other profile columns", async () => {
    const { error } = await w.lawyerA1.client
      .from("profiles")
      .update({ preferred_locale: "ro", email: `changed.${w.tag}@example.com` })
      .eq("id", w.lawyerA1.id);
    expect(error?.code).toBe("42501");
    const { data } = await admin().from("profiles").select("email").eq("id", w.lawyerA1.id).single();
    expect(data!.email).toBe(w.lawyerA1.email);
  });
});
