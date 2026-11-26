import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/calendar/[file]/route";
import { resetRateLimits } from "@/lib/security/rate-limit";
import type { Json } from "@/lib/supabase/database.types";
import { hashCalendarToken, renderCalendarFeed } from "@/server/calendar/feed";
import { createCalendarFeed, getMyCalendarFeed, revokeCalendarFeed } from "@/server/dal/calendar";
import { followCase } from "@/server/dal/notifications";
import { canonicalHash } from "@/server/monitoring/canonical";
import { contextFor } from "../helpers/context";
import { adminClient, anonClient, buildWorld, type World } from "../helpers/world";

/**
 * Private calendar link: only the token's hash is stored, the feed covers the
 * person's own cases, and it carries case numbers and court names only.
 * Synthetic data only.
 */

let w: World;
const TITLE = "Titlu confidențial client (sintetic)";
const SOLUTION = "Amână cauza pentru lipsă de procedură (text instanță sintetic)";

beforeAll(async () => {
  w = await buildWorld();
});
beforeEach(() => resetRateLimits());

const tokenOf = (url: string) => /\/api\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(url)![1];

async function caseWithHearing(assignee: string, hearingDate: string, time: string | null): Promise<string> {
  const { data, error } = await w.adminA.client
    .from("cases")
    .insert({
      organization_id: w.orgA,
      court_case_number: `${1000 + Math.floor(Math.random() * 900000)}/3/2026`,
      court_name: "Tribunalul București",
      title: TITLE,
      matter_type: "civil",
      assigned_user_id: assignee,
      created_by: w.adminA.id,
    })
    .select("id")
    .single();
  if (error) throw error;
  const now = new Date().toISOString();
  const snapshot = {
    courtCaseNumber: "x",
    courtName: "Tribunalul București",
    stage: "Fond",
    status: "În curs",
    hearings: [
      { date: "2026-01-10", time: "09:00", solutionType: "postponement", solutionText: SOLUTION },
      { date: hearingDate, time, solutionType: null, solutionText: null },
    ],
  };
  const { error: runError } = await adminClient().rpc("record_monitoring_run", {
    p_case_id: data.id,
    p_organization_id: w.orgA,
    p_triggered_by: null as unknown as string,
    p_trigger_type: "scheduled",
    p_provider: "mock",
    p_started_at: now,
    p_finished_at: now,
    p_outcome: "no_changes",
    p_snapshot: {
      source_reference: "mock://calendar",
      fetched_at: now,
      completeness: "complete",
      content_hash: canonicalHash(snapshot),
      data: snapshot,
    } as Json,
  });
  if (runError) throw runError;
  return data.id;
}

function futureDate(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("calendar link", () => {
  it("stores only the token's hash; the link is shown once", async () => {
    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const r = await createCalendarFeed(ctx);
    if (!r.ok) throw new Error(r.error);
    expect(r.data!.url).toMatch(/^http:\/\/localhost:3000\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    const token = tokenOf(r.data!.url);

    const { data: row } = await adminClient().from("calendar_feeds").select("token_hash").eq("user_id", w.lawyerA1.id).is("revoked_at", null).single();
    expect(row!.token_hash).toBe(hashCalendarToken(token));
    expect(row!.token_hash).not.toContain(token);

    // Users cannot read the hash back, and the app never needs it.
    const own = await w.lawyerA1.client.from("calendar_feeds").select("token_hash");
    expect(own.error).not.toBeNull();
    expect(await getMyCalendarFeed(ctx)).toMatchObject({ last_used_at: null });
  });

  it("the feed has the person's hearings and confirmed deadlines, with case number and court only", async () => {
    const mine = await caseWithHearing(w.lawyerA1.id, futureDate(20), "10:30");
    const colleagues = await caseWithHearing(w.lawyerA2.id, futureDate(21), null);
    const { data: confirmed } = await w.lawyerA1.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: mine, title: "Titlu termen confidențial", due_date: futureDate(10), created_by: w.lawyerA1.id })
      .select("id")
      .single();
    await w.lawyerA1.client.from("deadline_reminders").update({ status: "confirmed" }).eq("id", confirmed!.id);
    await w.lawyerA1.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: mine, title: "Propus, neconfirmat", due_date: futureDate(11), created_by: w.lawyerA1.id });

    const ctx = await contextFor(w.lawyerA1.client, w.orgA);
    const token = tokenOf((await getLinkUrl(ctx))!);
    const ics = (await renderCalendarFeed(token))!;

    const { data: c } = await adminClient().from("cases").select("court_case_number").eq("id", mine).single();
    const { data: other } = await adminClient().from("cases").select("court_case_number").eq("id", colleagues).single();
    expect(ics).toContain(`SUMMARY:Termen de judecată — dosar ${c!.court_case_number}`);
    expect(ics).toContain(`SUMMARY:Termen confirmat — dosar ${c!.court_case_number}`);
    expect(ics).toContain(`hearing-${mine}:${futureDate(20)}:10:30@dosaria`);
    expect(ics).toContain("LOCATION:Tribunalul București");
    // 10:30 in Bucharest is 08:30 or 09:30 UTC depending on the season.
    expect(ics).toMatch(new RegExp(`DTSTART:${futureDate(20).replace(/-/g, "")}T0[89]3000Z`));

    // Not included: past or decided hearings, unconfirmed deadlines, colleagues' cases, any titles or court text.
    expect(ics).not.toContain("20260110");
    expect(ics).not.toContain(other!.court_case_number);
    for (const secret of [TITLE, SOLUTION, "Titlu termen confidențial", "Propus, neconfirmat"]) {
      expect(ics).not.toContain(secret);
    }
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("an admin's feed includes followed cases only", async () => {
    const caseId = await caseWithHearing(w.lawyerA2.id, futureDate(30), null);
    const ctx = await contextFor(w.adminA.client, w.orgA);
    const r = await createCalendarFeed(ctx);
    const token = tokenOf(r.ok ? r.data!.url : "");
    const { data: c } = await adminClient().from("cases").select("court_case_number").eq("id", caseId).single();
    expect(await renderCalendarFeed(token)).not.toContain(c!.court_case_number);
    await followCase(ctx, caseId);
    expect(await renderCalendarFeed(token)).toContain(c!.court_case_number);
  });

  it("replacing or turning off a link stops the old one; inactive members get nothing", async () => {
    const ctx = await contextFor(w.assistantA.client, w.orgA);
    const first = await createCalendarFeed(ctx);
    const second = await createCalendarFeed(ctx);
    const oldToken = tokenOf(first.ok ? first.data!.url : "");
    const newToken = tokenOf(second.ok ? second.data!.url : "");
    expect(await renderCalendarFeed(oldToken)).toBeNull();
    expect(await renderCalendarFeed(newToken)).toContain("BEGIN:VCALENDAR"); // valid, even if empty

    const { data: active } = await adminClient().from("calendar_feeds").select("id").eq("user_id", w.assistantA.id).is("revoked_at", null);
    expect(active).toHaveLength(1);

    expect((await revokeCalendarFeed(ctx)).ok).toBe(true);
    expect(await renderCalendarFeed(newToken)).toBeNull();
    expect(await getMyCalendarFeed(ctx)).toBeNull();

    // Revoked is final: it cannot be switched back on.
    const { error } = await w.assistantA.client.from("calendar_feeds").update({ revoked_at: null }).eq("user_id", w.assistantA.id);
    expect(error).not.toBeNull();

    // A suspended member's link stops working.
    const third = await createCalendarFeed(ctx);
    const token = tokenOf(third.ok ? third.data!.url : "");
    const { data: m } = await adminClient()
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", w.orgA)
      .eq("user_id", w.assistantA.id)
      .single();
    await w.adminA.client.from("organization_memberships").update({ status: "suspended" }).eq("id", m!.id);
    try {
      expect(await renderCalendarFeed(token)).toBeNull();
    } finally {
      await w.adminA.client.from("organization_memberships").update({ status: "active" }).eq("id", m!.id);
    }
  });

  it("nobody can create a link for someone else, or read the feed through the API", async () => {
    const forOther = await w.adminA.client
      .from("calendar_feeds")
      .insert({ organization_id: w.orgA, user_id: w.lawyerA2.id, token_hash: "a".repeat(64) })
      .select("user_id")
      .single();
    // The guard forces the caller as owner, so this becomes the admin's own row (or fails), never lawyer A2's.
    expect(forOther.error !== null || forOther.data?.user_id === w.adminA.id).toBe(true);
    const crossTenant = await w.lawyerB1.client.rpc("replace_calendar_feed", { p_organization_id: w.orgA, p_token_hash: "b".repeat(64) });
    expect(crossTenant.error).not.toBeNull();

    for (const client of [anonClient(), w.lawyerA1.client]) {
      const { error } = await client.rpc("calendar_feed", { p_token_hash: "c".repeat(64) });
      expect(error).not.toBeNull();
    }
  });
});

describe("calendar route", () => {
  const get = (file: string) =>
    GET(new NextRequest(`http://localhost:3000/api/calendar/${file}`), { params: Promise.resolve({ file }) });

  it("answers 404 for malformed, unknown or revoked links, and serves a valid one", async () => {
    for (const file of ["nope", "short.ics", `${"A".repeat(43)}.ics`, `${"A".repeat(43)}.txt`]) {
      const res = await get(file);
      expect(res.status).toBe(404);
    }
    const ctx = await contextFor(w.lawyerA2.client, w.orgA);
    const r = await createCalendarFeed(ctx);
    const token = tokenOf(r.ok ? r.data!.url : "");
    const res = await get(`${token}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toContain("BEGIN:VCALENDAR");
    expect((await getMyCalendarFeed(ctx))?.last_used_at).not.toBeNull();
  });
});

/** Create a link and return its URL (helper for readability above). */
async function getLinkUrl(ctx: Awaited<ReturnType<typeof contextFor>>): Promise<string | null> {
  const r = await createCalendarFeed(ctx);
  return r.ok ? r.data!.url : null;
}
