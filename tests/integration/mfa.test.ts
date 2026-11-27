import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDictionary } from "@/i18n";
import { resetRateLimits } from "@/lib/security/rate-limit";
import type { UserSupabaseClient } from "@/lib/supabase/server";
import { confirmEnrollment, isMfaPending, removeFactor, startEnrollment, verifySignIn } from "@/server/mfa";
import { nextTotpWindow, totp } from "../helpers/totp";
import { adminClient, buildWorld, createConfirmedUser, signIn, type Db, type World } from "../helpers/world";

/**
 * Two-step verification. The key property: once a user has a verified
 * authenticator, a password-only session gets NOTHING from the database,
 * even when it talks to the API directly. Synthetic users only.
 */

const t = getDictionary("en");
let w: World;
let email: string;
let userId: string;
let secret: string;

const asApp = (client: Db) => client as unknown as UserSupabaseClient;

beforeAll(async () => {
  w = await buildWorld();
  email = `mfa-lawyer.${w.tag}@example.com`;
  userId = await createConfirmedUser(email, "Avocat MFA (sintetic)");
  const { error } = await adminClient()
    .from("organization_memberships")
    .insert({ organization_id: w.orgA, user_id: userId, role: "lawyer" });
  if (error) throw error;
  await adminClient().from("cases").update({ assigned_user_id: userId }).eq("id", w.caseA1);
}, 60_000);
beforeEach(() => resetRateLimits());

describe("two-step verification", () => {
  it("every public table has RLS and the two-step policy", async () => {
    const { data, error } = await adminClient().rpc("security_self_check");
    expect(error).toBeNull();
    expect(data).toEqual({ tables_without_rls: [], tables_without_mfa_policy: [] });
    // Not callable by users.
    expect((await w.lawyerA1.client.rpc("security_self_check")).error).not.toBeNull();
  });

  it("setting up: QR code and key are returned once, and a wrong code does not turn it on", async () => {
    const client = await signIn(email);
    const started = await startEnrollment(asApp(client), userId, t);
    if (!started.ok) throw new Error(started.error);
    expect(started.data!.qrCode).toMatch(/^data:image\/svg\+xml/);
    expect(started.data!.secret).toMatch(/^[A-Z2-7]{16,}$/);

    const wrong = await client.auth.mfa.challengeAndVerify({ factorId: started.data!.factorId, code: "000000" });
    expect(wrong.error).not.toBeNull();
    const { data: factors } = await client.auth.mfa.listFactors();
    expect(factors!.totp).toHaveLength(0); // still not verified

    // Starting again discards the unconfirmed set-up.
    const again = await startEnrollment(asApp(client), userId, t);
    if (!again.ok) throw new Error(again.error);
    const { data: all } = await client.auth.mfa.listFactors();
    expect(all!.all.map((f) => f.id)).toEqual([again.data!.factorId]);

    secret = again.data!.secret;
    const confirmed = await confirmEnrollment(asApp(client), userId, t, { factorId: again.data!.factorId, code: totp(secret) });
    expect(confirmed.ok ? confirmed.message : confirmed.error).toBe(t.success.mfaEnabled);
    const { data: claims } = await client.auth.getClaims();
    expect(claims!.claims.aal).toBe("aal2");
    // The upgraded session still sees the case.
    expect((await client.from("cases").select("id").eq("id", w.caseA1)).data).toHaveLength(1);
  });

  it("a password-only session is refused everywhere until the code is entered", async () => {
    const client = await signIn(email);
    const { data: u } = await client.auth.getUser();
    expect(await isMfaPending(asApp(client), u.user!)).toBe(true);

    for (const table of ["cases", "organization_memberships", "profiles", "case_events", "notifications", "case_notes"] as const) {
      const { data } = await client.from(table).select("*").limit(5);
      expect(data ?? [], table).toEqual([]);
    }
    const write = await client
      .from("case_notes")
      .insert({ organization_id: w.orgA, case_id: w.caseA1, body: "fără cod (sintetic)" });
    expect(write.error).not.toBeNull();
    expect((await client.rpc("create_organization", { p_name: "Fără cod" })).error?.code).toBe("42501");
    expect((await client.rpc("my_upcoming_deadlines", { p_organization_id: w.orgA, p_days: 30 })).data ?? []).toEqual([]);

    // Wrong code: refused (and audited). Right code: full access.
    const bad = await verifySignIn(asApp(client), userId, t, { code: "123456" });
    expect(bad.ok ? null : bad.error).toBe(t.errors.mfaInvalidCode);
    const { data: audit } = await adminClient().from("audit_logs").select("action").eq("actor_user_id", userId).eq("action", "security.mfa_failed");
    expect(audit!.length).toBeGreaterThan(0);

    await nextTotpWindow();
    const good = await verifySignIn(asApp(client), userId, t, { code: totp(secret) });
    expect(good.ok).toBe(true);
    expect(await isMfaPending(asApp(client), (await client.auth.getUser()).data.user!)).toBe(false);
    expect((await client.from("cases").select("id").eq("id", w.caseA1)).data).toHaveLength(1);
  }, 60_000);

  it("users without two-step verification are unaffected", async () => {
    const { data } = await w.lawyerA2.client.from("cases").select("id").eq("id", w.caseA2);
    expect(data).toHaveLength(1);
    const { data: u } = await w.lawyerA2.client.auth.getUser();
    expect(await isMfaPending(asApp(w.lawyerA2.client), u.user!)).toBe(false);
  });

  it("removing a device needs a current code; with none left, a password is enough again", async () => {
    const client = await signIn(email);
    await nextTotpWindow();
    expect((await verifySignIn(asApp(client), userId, t, { code: totp(secret) })).ok).toBe(true);
    const { data: f } = await client.auth.mfa.listFactors();
    const factorId = f!.totp[0].id;

    resetRateLimits();
    const refused = await removeFactor(asApp(client), userId, t, { factorId, code: "000000" });
    expect(refused.ok).toBe(false);
    expect((await client.auth.mfa.listFactors()).data!.totp).toHaveLength(1);

    await nextTotpWindow();
    const removed = await removeFactor(asApp(client), userId, t, { factorId, code: totp(secret) });
    expect(removed.ok ? removed.message : removed.error).toBe(t.success.mfaDisabled);

    const fresh = await signIn(email);
    expect((await fresh.from("cases").select("id").eq("id", w.caseA1)).data).toHaveLength(1);
    const { data: audit } = await adminClient().from("audit_logs").select("action").eq("actor_user_id", userId).in("action", ["security.mfa_enabled", "security.mfa_disabled"]);
    expect(new Set(audit!.map((a) => a.action))).toEqual(new Set(["security.mfa_enabled", "security.mfa_disabled"]));
  }, 90_000);
});
