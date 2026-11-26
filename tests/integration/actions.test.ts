import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminClient,
  anonClient,
  buildWorld,
  createConfirmedUser,
  signIn,
  TEST_PASSWORD,
  type Db,
  type World,
} from "../helpers/world";

/*
 * Authorization tests for every Server Action and the auth Route Handler.
 * Only the Next.js request boundary is mocked (cookies/headers/redirect and
 * the Supabase client factory, which returns a REAL signed-in client for the
 * acting user). Everything behind it — validation, DAL authorization, RLS,
 * triggers and constraints — runs for real against the local database.
 */

const state = vi.hoisted(() => ({
  client: null as unknown,
  cookieJar: new Map<string, string>(),
}));

class RedirectError extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => state.client,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookieJar.has(name) ? { name, value: state.cookieJar.get(name) } : undefined),
    getAll: () => [...state.cookieJar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void state.cookieJar.set(name, value),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
  notFound: () => {
    throw new RedirectError("/404");
  },
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  // Per-request memoization is irrelevant here and must not leak identities between test calls.
  cache: <T,>(fn: T) => fn,
}));

const caseActions = await import("@/app/actions/cases");
const monitoringActions = await import("@/app/actions/monitoring");
const reminderActions = await import("@/app/actions/reminders");
const orgActions = await import("@/app/actions/organization");
const authActions = await import("@/app/actions/auth");
const localeActions = await import("@/app/actions/locale");
const { getDictionary } = await import("@/i18n");
const { resetRateLimits } = await import("@/lib/security/rate-limit");
const { GET: confirmRoute } = await import("@/app/auth/confirm/route");

let w: World;

function actAs(client: Db | null, activeOrg?: string) {
  state.client = client ?? anonClient();
  state.cookieJar.clear();
  if (activeOrg) state.cookieJar.set("dosaria_active_org", activeOrg);
}

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function run<T>(fn: () => Promise<T>): Promise<T | { redirect: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof RedirectError) return { redirect: e.url };
    throw e;
  }
}

const validCase = { courtCaseNumber: "4321/3/2026", courtName: "Tribunalul București", title: "Dosar acțiune", matterType: "civil" };

beforeAll(async () => {
  w = await buildWorld();
});
beforeEach(() => resetRateLimits());

describe("Scenario F — unauthenticated calls to every Server Action are rejected", () => {
  const cases: [string, (fd: FormData) => Promise<unknown>][] = [
    ["createCaseAction", (fd) => caseActions.createCaseAction(null, fd)],
    ["updateCaseAction", (fd) => caseActions.updateCaseAction(null, fd)],
    ["assignCaseAction", (fd) => caseActions.assignCaseAction(null, fd)],
    ["archiveCaseAction", (fd) => caseActions.archiveCaseAction(null, fd)],
    ["checkCaseAction", (fd) => monitoringActions.checkCaseAction(null, fd)],
    ["createReminderAction", (fd) => reminderActions.createReminderAction(null, fd)],
    ["reminderStatusAction", (fd) => reminderActions.reminderStatusAction(null, fd)],
    ["deleteReminderAction", (fd) => reminderActions.deleteReminderAction(null, fd)],
    ["createOrganizationAction", (fd) => orgActions.createOrganizationAction(null, fd)],
    ["renameOrganizationAction", (fd) => orgActions.renameOrganizationAction(null, fd)],
    ["inviteMemberAction", (fd) => orgActions.inviteMemberAction(null, fd)],
    ["revokeInvitationAction", (fd) => orgActions.revokeInvitationAction(null, fd)],
    ["changeMemberRoleAction", (fd) => orgActions.changeMemberRoleAction(null, fd)],
    ["changeMemberStatusAction", (fd) => orgActions.changeMemberStatusAction(null, fd)],
    ["acceptInvitationAction", (fd) => orgActions.acceptInvitationAction(null, fd)],
    ["updateProfileAction", (fd) => orgActions.updateProfileAction(null, fd)],
  ];

  it.each(cases)("%s returns unauthenticated", async (_name, call) => {
    actAs(null);
    const fd = form({ ...validCase, caseId: w.caseA1, reminderId: w.reminderA1, action: "confirm", name: "X Firm", fullName: "X" });
    const result = (await run(() => call(fd))) as { ok?: boolean; code?: string };
    expect(result).toMatchObject({ ok: false, code: "unauthenticated" });
  });

  it("switchOrganizationAction redirects anonymous callers to login", async () => {
    actAs(null);
    expect(await run(() => orgActions.switchOrganizationAction(form({ organizationId: w.orgA })))).toEqual({ redirect: "/login" });
  });

  it("updatePasswordAction requires a session", async () => {
    actAs(null);
    const r = await authActions.updatePasswordAction(null, form({ password: "Valid-Password-1", confirmPassword: "Valid-Password-1" }));
    expect(r).toMatchObject({ ok: false, code: "unauthenticated" });
  });
});

describe("case actions", () => {
  it("createCaseAction ignores injected organization_id / assignee from a lawyer", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    const r = await run(() =>
      caseActions.createCaseAction(
        null,
        form({ ...validCase, organization_id: w.orgB, organizationId: w.orgB, assignedUserId: w.lawyerA2.id, created_by: w.lawyerA2.id }),
      ),
    );
    expect(r).toHaveProperty("redirect");
    const id = (r as { redirect: string }).redirect.split("/").pop()!;
    const { data } = await adminClient().from("cases").select("organization_id, assigned_user_id, created_by").eq("id", id).single();
    expect(data).toEqual({ organization_id: w.orgA, assigned_user_id: w.lawyerA1.id, created_by: w.lawyerA1.id });
  });

  it("an active-org cookie naming another tenant does not grant access to it (Scenario D)", async () => {
    actAs(w.lawyerA1.client, w.orgB);
    const r = await run(() => caseActions.createCaseAction(null, form({ ...validCase, courtCaseNumber: "4322/3/2026" })));
    expect(r).toHaveProperty("redirect");
    const id = (r as { redirect: string }).redirect.split("/").pop()!;
    const { data } = await adminClient().from("cases").select("organization_id").eq("id", id).single();
    expect(data!.organization_id).toBe(w.orgA);
  });

  it("assistants cannot create cases", async () => {
    actAs(w.assistantA.client, w.orgA);
    expect(await run(() => caseActions.createCaseAction(null, form(validCase)))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("updateCaseAction: other lawyer's / other org's case → not_found; protected fields ignored (Scenario E)", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    for (const caseId of [w.caseA2, w.caseB1]) {
      const r = await run(() => caseActions.updateCaseAction(null, form({ ...validCase, status: "active", caseId })));
      expect(r).toMatchObject({ ok: false, code: "not_found" });
    }
    const r = await run(() =>
      caseActions.updateCaseAction(
        null,
        form({
          ...validCase,
          courtCaseNumber: "1234/3/2026", // A1's own number (4321/3/2026 is taken by an earlier test → unique conflict)
          title: "Titlu actualizat",
          status: "active",
          caseId: w.caseA1,
          organization_id: w.orgB,
          assigned_user_id: w.lawyerA2.id,
        }),
      ),
    );
    expect(r).toEqual({ redirect: `/cases/${w.caseA1}` });
    const { data } = await adminClient().from("cases").select("title, organization_id, assigned_user_id").eq("id", w.caseA1).single();
    expect(data).toEqual({ title: "Titlu actualizat", organization_id: w.orgA, assigned_user_id: w.lawyerA1.id });
  });

  it("assignCaseAction is admin-only and scoped to the admin's organization", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    expect(await run(() => caseActions.assignCaseAction(null, form({ caseId: w.caseA1, assignedUserId: w.lawyerA2.id })))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    actAs(w.adminA.client, w.orgA);
    expect(await run(() => caseActions.assignCaseAction(null, form({ caseId: w.caseB1, assignedUserId: w.lawyerA2.id })))).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await run(() => caseActions.assignCaseAction(null, form({ caseId: w.caseA1, assignedUserId: w.lawyerB1.id })))).toMatchObject({
      ok: false,
      code: "validation",
    });
    expect(await run(() => caseActions.assignCaseAction(null, form({ caseId: w.caseA1, assignedUserId: w.lawyerA1.id })))).toMatchObject({
      ok: true,
    });
  });

  it("archiveCaseAction: not for other users' cases", async () => {
    actAs(w.lawyerA2.client, w.orgA);
    expect(await run(() => caseActions.archiveCaseAction(null, form({ caseId: w.caseA1 })))).toMatchObject({ ok: false, code: "not_found" });
    actAs(w.assistantA.client, w.orgA);
    expect(await run(() => caseActions.archiveCaseAction(null, form({ caseId: w.caseA2 })))).toMatchObject({ ok: false, code: "forbidden" });
  });
});

describe("monitoring action", () => {
  it("checkCaseAction: inaccessible case → not_found; own case → ok", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    expect(await run(() => monitoringActions.checkCaseAction(null, form({ caseId: w.caseB1 })))).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await run(() => monitoringActions.checkCaseAction(null, form({ caseId: w.caseA2 })))).toMatchObject({
      ok: false,
      code: "not_found",
    });
    const own = (await run(() => monitoringActions.checkCaseAction(null, form({ caseId: w.caseA1 })))) as { ok: boolean };
    expect(typeof own.ok).toBe("boolean");
  });

  it("assistants can trigger a check on an assigned case (read access)", async () => {
    actAs(w.assistantA.client, w.orgA);
    const r = (await run(() => monitoringActions.checkCaseAction(null, form({ caseId: w.caseA2 })))) as { code?: string };
    expect(r.code).not.toBe("not_found");
    expect(r.code).not.toBe("forbidden");
  });
});

describe("reminder actions", () => {
  it("createReminderAction: other org → not_found, assistant → forbidden, lawyer → proposed", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    const fields = { title: "Termen depunere", dueDate: "2027-01-15" };
    expect(await run(() => reminderActions.createReminderAction(null, form({ ...fields, caseId: w.caseB1 })))).toMatchObject({
      ok: false,
      code: "not_found",
    });
    actAs(w.assistantA.client, w.orgA);
    expect(await run(() => reminderActions.createReminderAction(null, form({ ...fields, caseId: w.caseA2 })))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    actAs(w.lawyerA1.client, w.orgA);
    // Injected status/organization are ignored: reminders always start as "proposed".
    expect(
      await run(() =>
        reminderActions.createReminderAction(null, form({ ...fields, caseId: w.caseA1, status: "confirmed", organization_id: w.orgB })),
      ),
    ).toMatchObject({ ok: true });
    const { data } = await adminClient()
      .from("deadline_reminders")
      .select("status, organization_id, origin")
      .eq("case_id", w.caseA1)
      .eq("title", "Termen depunere")
      .single();
    expect(data).toEqual({ status: "proposed", organization_id: w.orgA, origin: "manual" });
  });

  it("only an authorized lawyer can confirm; confirmation records the real confirmer", async () => {
    // A reminder on the assistant's case A2, created by lawyer A2.
    const { data: rem } = await w.lawyerA2.client
      .from("deadline_reminders")
      .insert({ organization_id: w.orgA, case_id: w.caseA2, title: "Termen A2", due_date: "2027-02-01", created_by: w.lawyerA2.id })
      .select("id")
      .single();

    actAs(w.assistantA.client, w.orgA);
    expect(
      await run(() => reminderActions.reminderStatusAction(null, form({ reminderId: rem!.id, action: "confirm", caseId: w.caseA2 }))),
    ).toMatchObject({ ok: false, code: "forbidden" });

    actAs(w.lawyerA1.client, w.orgA);
    expect(
      await run(() => reminderActions.reminderStatusAction(null, form({ reminderId: rem!.id, action: "confirm", caseId: w.caseA2 }))),
    ).toMatchObject({ ok: false, code: "not_found" });

    actAs(w.lawyerB1.client, w.orgB);
    expect(
      await run(() => reminderActions.reminderStatusAction(null, form({ reminderId: rem!.id, action: "confirm", caseId: w.caseA2 }))),
    ).toMatchObject({ ok: false, code: "not_found" });

    actAs(w.lawyerA2.client, w.orgA);
    expect(
      await run(() => reminderActions.reminderStatusAction(null, form({ reminderId: rem!.id, action: "confirm", caseId: w.caseA2 }))),
    ).toMatchObject({ ok: true });
    const { data } = await adminClient().from("deadline_reminders").select("status, confirmed_by, confirmed_at").eq("id", rem!.id).single();
    expect(data!.status).toBe("confirmed");
    expect(data!.confirmed_by).toBe(w.lawyerA2.id);
    expect(data!.confirmed_at).not.toBeNull();

    expect(
      await run(() => reminderActions.reminderStatusAction(null, form({ reminderId: rem!.id, action: "complete", caseId: w.caseA2 }))),
    ).toMatchObject({ ok: true });
    // Confirmed/completed reminders cannot be deleted.
    expect(await run(() => reminderActions.deleteReminderAction(null, form({ reminderId: rem!.id, caseId: w.caseA2 })))).toMatchObject({
      ok: false,
    });

    const { data: audit } = await adminClient().from("audit_logs").select("action, actor_user_id").eq("resource_id", rem!.id);
    expect(audit!.some((a) => a.action === "reminder.confirmed" && a.actor_user_id === w.lawyerA2.id)).toBe(true);
  });

  it("deleteReminderAction cannot delete another tenant's reminder", async () => {
    actAs(w.adminA.client, w.orgA);
    expect(await run(() => reminderActions.deleteReminderAction(null, form({ reminderId: w.reminderB1 })))).toMatchObject({ ok: false });
    const { count } = await adminClient().from("deadline_reminders").select("id", { count: "exact", head: true }).eq("id", w.reminderB1);
    expect(count).toBe(1);
  });
});

describe("organization actions", () => {
  it("changeMemberRoleAction: lawyer cannot promote self (Scenario C); admin cannot touch another org", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    expect(
      await run(() => orgActions.changeMemberRoleAction(null, form({ membershipId: w.membershipA1, role: "admin" }))),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const { data } = await adminClient().from("organization_memberships").select("role").eq("id", w.membershipA1).single();
    expect(data!.role).toBe("lawyer");

    const { data: bMember } = await adminClient()
      .from("organization_memberships")
      .select("id")
      .eq("organization_id", w.orgB)
      .eq("user_id", w.lawyerB1.id)
      .single();
    actAs(w.adminA.client, w.orgA);
    expect(await run(() => orgActions.changeMemberRoleAction(null, form({ membershipId: bMember!.id, role: "admin" })))).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await run(() => orgActions.changeMemberStatusAction(null, form({ membershipId: bMember!.id, status: "removed" })))).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("renameOrganizationAction / inviteMemberAction are admin-only", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    expect(await run(() => orgActions.renameOrganizationAction(null, form({ name: "Hijacked" })))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await run(() => orgActions.inviteMemberAction(null, form({ email: "x@example.com", role: "admin" })))).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("switchOrganizationAction never activates an organization the user does not belong to", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    await run(() => orgActions.switchOrganizationAction(form({ organizationId: w.orgB })));
    expect(state.cookieJar.get("dosaria_active_org")).toBe(w.orgA);
  });

  it("invitation flow: expiring, single-use, bound to the verified invitee email", async () => {
    const inviteeEmail = `invitee.${w.tag}@example.com`;
    const otherEmail = `other.${w.tag}@example.com`;
    const inviteeId = await createConfirmedUser(inviteeEmail, "Invitat (sintetic)");
    await createConfirmedUser(otherEmail, "Altcineva (sintetic)");

    actAs(w.adminA.client, w.orgA);
    const created = (await run(() => orgActions.inviteMemberAction(null, form({ email: inviteeEmail, role: "lawyer" })))) as {
      ok: boolean;
      data?: { link: string };
    };
    expect(created.ok).toBe(true);
    const token = new URL(created.data!.link).searchParams.get("token")!;
    const { data: stored } = await adminClient().from("organization_invitations").select("token_hash").eq("email", inviteeEmail).single();
    expect(stored!.token_hash).not.toContain(token); // only the hash is stored

    actAs(await signIn(otherEmail));
    expect(await run(() => orgActions.acceptInvitationAction(null, form({ token })))).toMatchObject({ ok: false, code: "forbidden" });

    actAs(await signIn(inviteeEmail));
    expect(await run(() => orgActions.acceptInvitationAction(null, form({ token })))).toEqual({ redirect: "/dashboard" });
    const { data: m } = await adminClient()
      .from("organization_memberships")
      .select("role, status")
      .eq("organization_id", w.orgA)
      .eq("user_id", inviteeId)
      .single();
    expect(m).toEqual({ role: "lawyer", status: "active" });

    // Single use.
    expect(await run(() => orgActions.acceptInvitationAction(null, form({ token })))).toMatchObject({ ok: false });
    // Random tokens are rejected.
    expect(await run(() => orgActions.acceptInvitationAction(null, form({ token: "A".repeat(43) })))).toMatchObject({
      ok: false,
      code: "validation",
    });

    const { data: audit } = await adminClient().from("audit_logs").select("action").eq("organization_id", w.orgA).eq("action", "invitation.accepted");
    expect(audit!.length).toBeGreaterThan(0);
  });

  it("an expired invitation cannot be accepted", async () => {
    const email = `expired.${w.tag}@example.com`;
    await createConfirmedUser(email, "Expirat (sintetic)");
    const token = "E".repeat(43);
    const { createHash } = await import("node:crypto");
    await adminClient().from("organization_invitations").insert({
      organization_id: w.orgA,
      email,
      role: "lawyer",
      token_hash: createHash("sha256").update(token).digest("hex"),
      invited_by: w.adminA.id,
      created_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      expires_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    actAs(await signIn(email));
    expect(await run(() => orgActions.acceptInvitationAction(null, form({ token })))).toMatchObject({ ok: false, code: "validation" });
  });

  it("updateProfileAction only touches the caller's own profile", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    expect(await run(() => orgActions.updateProfileAction(null, form({ fullName: "Avocat A1 Redenumit", id: w.lawyerA2.id })))).toMatchObject({
      ok: true,
    });
    const { data } = await adminClient().from("profiles").select("id, full_name").in("id", [w.lawyerA1.id, w.lawyerA2.id]);
    expect(data!.find((p) => p.id === w.lawyerA1.id)!.full_name).toBe("Avocat A1 Redenumit");
    expect(data!.find((p) => p.id === w.lawyerA2.id)!.full_name).toBe("Avocat A2 (sintetic)");
  });
});

describe("auth actions and route handler", () => {
  it("loginAction gives the same message for wrong password and unknown account", async () => {
    actAs(anonClient());
    const wrong = await run(() => authActions.loginAction(null, form({ email: w.lawyerA1.email, password: "Wrong-Password-1" })));
    const unknown = await run(() => authActions.loginAction(null, form({ email: `nobody.${w.tag}@example.com`, password: "Wrong-Password-1" })));
    expect(wrong).toMatchObject({ ok: false });
    expect((wrong as { error: string }).error).toBe((unknown as { error: string }).error);
  });

  it("loginAction never redirects off-site", async () => {
    actAs(anonClient());
    const r = await run(() =>
      authActions.loginAction(null, form({ email: w.lawyerB1.email, password: "Dosaria-Local-Test-2026", next: "https://evil.example" })),
    );
    expect(r).toEqual({ redirect: "/dashboard" });
  });

  it("loginAction is rate limited", async () => {
    actAs(anonClient());
    let last: unknown;
    for (let i = 0; i < 12; i++) {
      last = await run(() => authActions.loginAction(null, form({ email: w.adminB.email, password: "Wrong-Password-1" })));
    }
    expect(last).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("forgotPasswordAction does not reveal whether an account exists", async () => {
    actAs(anonClient());
    const a = await authActions.forgotPasswordAction(null, form({ email: `nobody2.${w.tag}@example.com` }));
    expect(a).toMatchObject({ ok: true });
  });

  it("/auth/confirm rejects invalid tokens and sanitizes `next`", async () => {
    actAs(anonClient());
    const { NextRequest } = await import("next/server");
    const bad = await run(() =>
      confirmRoute(new NextRequest("http://localhost:3000/auth/confirm?token_hash=invalidtoken123&type=email&next=https://evil.example")),
    );
    expect(bad).toEqual({ redirect: "/auth/error" });
    const missing = await run(() => confirmRoute(new NextRequest("http://localhost:3000/auth/confirm?type=signup")));
    expect(missing).toEqual({ redirect: "/auth/error" });
  });
});

describe("interface language (presentation only)", () => {
  const en = getDictionary("en");
  const ro = getDictionary("ro");

  it("messages follow the language cookie; Romanian is the default", async () => {
    actAs(null);
    expect(await run(() => caseActions.createCaseAction(null, form(validCase)))).toMatchObject({
      ok: false,
      code: "unauthenticated",
      error: ro.errors.codes.unauthenticated,
    });
    state.cookieJar.set("dosaria_locale", "en");
    expect(await run(() => caseActions.createCaseAction(null, form(validCase)))).toMatchObject({
      ok: false,
      code: "unauthenticated",
      error: en.errors.codes.unauthenticated,
    });
  });

  it("an unknown language cookie falls back to Romanian", async () => {
    actAs(null);
    state.cookieJar.set("dosaria_locale", "<script>");
    expect(await run(() => caseActions.createCaseAction(null, form(validCase)))).toMatchObject({
      error: ro.errors.codes.unauthenticated,
    });
  });

  it("validation messages are translated, and the language never changes authorization", async () => {
    actAs(w.lawyerA1.client, w.orgA);
    state.cookieJar.set("dosaria_locale", "en");
    const enResult = (await run(() => caseActions.createCaseAction(null, form({ ...validCase, title: "x" })))) as {
      fieldErrors?: Record<string, string[]>;
    };
    expect(enResult.fieldErrors?.title).toEqual(["Title: at least 2 characters."]);

    actAs(w.lawyerA1.client, w.orgA);
    state.cookieJar.set("dosaria_locale", "ro");
    const roResult = (await run(() => caseActions.createCaseAction(null, form({ ...validCase, title: "x" })))) as {
      fieldErrors?: Record<string, string[]>;
    };
    expect(roResult.fieldErrors?.title).toEqual(["Titlul: minimum 2 caractere."]);

    // Same denial in both languages for another tenant's case.
    for (const locale of ["en", "ro"]) {
      actAs(w.lawyerA1.client, w.orgA);
      state.cookieJar.set("dosaria_locale", locale);
      expect(await run(() => caseActions.archiveCaseAction(null, form({ caseId: w.caseB1 })))).toMatchObject({
        ok: false,
        code: "not_found",
      });
    }
  });

  it("setLocaleAction saves the choice to the caller's own profile only and ignores unknown values", async () => {
    await adminClient().from("profiles").update({ preferred_locale: null }).in("id", [w.lawyerA1.id, w.lawyerA2.id]);
    actAs(w.lawyerA1.client, w.orgA);
    await localeActions.setLocaleAction(form({ locale: "en", id: w.lawyerA2.id, userId: w.lawyerA2.id }));
    expect(state.cookieJar.get("dosaria_locale")).toBe("en");

    await localeActions.setLocaleAction(form({ locale: "de" }));
    expect(state.cookieJar.get("dosaria_locale")).toBe("en");

    const { data } = await adminClient().from("profiles").select("id, preferred_locale").in("id", [w.lawyerA1.id, w.lawyerA2.id]);
    expect(data!.find((p) => p.id === w.lawyerA1.id)!.preferred_locale).toBe("en");
    expect(data!.find((p) => p.id === w.lawyerA2.id)!.preferred_locale).toBeNull();
  });

  it("setLocaleAction works for anonymous visitors (cookie only)", async () => {
    actAs(null);
    await localeActions.setLocaleAction(form({ locale: "en" }));
    expect(state.cookieJar.get("dosaria_locale")).toBe("en");
  });

  it("loginAction restores the saved language, or saves the current one when none is stored", async () => {
    await adminClient().from("profiles").update({ preferred_locale: "en" }).eq("id", w.lawyerB1.id);
    actAs(anonClient());
    expect(await run(() => authActions.loginAction(null, form({ email: w.lawyerB1.email, password: TEST_PASSWORD })))).toEqual({
      redirect: "/dashboard",
    });
    expect(state.cookieJar.get("dosaria_locale")).toBe("en");

    await adminClient().from("profiles").update({ preferred_locale: null }).eq("id", w.adminB.id);
    actAs(anonClient());
    expect(await run(() => authActions.loginAction(null, form({ email: w.adminB.email, password: TEST_PASSWORD })))).toEqual({
      redirect: "/dashboard",
    });
    const { data } = await adminClient().from("profiles").select("preferred_locale").eq("id", w.adminB.id).single();
    expect(data!.preferred_locale).toBe("ro");
  });
});
