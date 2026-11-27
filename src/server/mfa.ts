import "server-only";
import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import type { Dictionary } from "@/i18n";
import { fail, logServerError, type ActionResult } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import type { MfaEnrollment } from "@/lib/shared-types";
import type { UserSupabaseClient } from "@/lib/supabase/server";
import { fieldErrorsOf, mfaCodeSchema, mfaFactorCodeSchema } from "@/lib/validation";
import { logSecurityEvent } from "@/server/dal/audit";

/**
 * Two-step verification with an authenticator app (Supabase Auth TOTP).
 *
 * The database is the enforcement point (see migration 20261129000200_mfa):
 * once a user has a verified factor, every table refuses a session that has
 * not been upgraded with a code. This module drives the user-facing steps.
 * The TOTP secret and QR code are returned to the user once, during setup,
 * and are never logged.
 */

export type MfaFactor = { id: string; createdAt: string };
export type { MfaEnrollment } from "@/lib/shared-types";

const ISSUER = "DosarIA";

/** True when the user has a verified factor but this session has not been upgraded with a code yet. */
export async function isMfaPending(supabase: UserSupabaseClient, user: Pick<User, "factors">): Promise<boolean> {
  const hasVerified = (user.factors ?? []).some((f) => f.status === "verified");
  if (!hasVerified) return false;
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.aal !== "aal2";
}

export async function listVerifiedFactors(supabase: UserSupabaseClient): Promise<MfaFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    logServerError("mfa.listFactors", error);
    return [];
  }
  return data.totp.map((f) => ({ id: f.id, createdAt: f.created_at }));
}

function isRateLimitError(error: { code?: string; status?: number }) {
  return error.status === 429 || error.code === "over_request_rate_limit" || error.code === "too_many_requests";
}

function codeError(t: Dictionary, error: { code?: string; status?: number }): ActionResult<never> {
  if (isRateLimitError(error)) return fail(t, "rate_limited");
  return fail(t, "validation", t.errors.mfaInvalidCode, { code: [t.errors.mfaInvalidCode] });
}

/** Start adding an authenticator app. Abandoned, unconfirmed set-ups are discarded first. */
export async function startEnrollment(supabase: UserSupabaseClient, userId: string, t: Dictionary): Promise<ActionResult<MfaEnrollment>> {
  if (!rateLimit(`mfa-enroll:${userId}`, 10, 60 * 60_000).ok) return fail(t, "rate_limited");
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) {
    logServerError("mfa.listFactors", listError);
    return fail(t, "internal");
  }
  for (const f of factors.all) {
    if (f.factor_type === "totp" && f.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: ISSUER,
    // Must be unique per user; never shown (devices are listed by date).
    friendlyName: `dosaria-${randomUUID().slice(0, 8)}`,
  });
  if (error || !data) {
    if (error) logServerError("mfa.enroll", error);
    if (error && isRateLimitError(error)) return fail(t, "rate_limited");
    return fail(t, "internal", t.errors.mfaSetupFailed);
  }
  const svg = data.totp.qr_code;
  const qrCode = svg.startsWith("data:") ? svg : `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return { ok: true, data: { factorId: data.id, qrCode, secret: data.totp.secret } };
}

/** Confirm a new authenticator app with its first code. The session is upgraded on success. */
export async function confirmEnrollment(
  supabase: UserSupabaseClient,
  userId: string,
  t: Dictionary,
  input: unknown,
): Promise<ActionResult> {
  const parsed = mfaFactorCodeSchema.safeParse(input);
  if (!parsed.success) return fail(t, "validation", undefined, fieldErrorsOf(parsed.error, t));
  if (!rateLimit(`mfa-verify:${userId}`, LIMITS.mfaVerify.limit, LIMITS.mfaVerify.windowMs).ok) return fail(t, "rate_limited");

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
  if (error) return codeError(t, error);
  await logSecurityEvent({ user: { id: userId } }, { action: "security.mfa_enabled", resourceType: "user", resourceId: userId });
  return { ok: true, message: t.success.mfaEnabled };
}

/** Upgrade a password-only session with a code from any of the user's devices. */
export async function verifySignIn(supabase: UserSupabaseClient, userId: string, t: Dictionary, input: unknown): Promise<ActionResult> {
  const parsed = mfaCodeSchema.safeParse(input);
  if (!parsed.success) return fail(t, "validation", undefined, fieldErrorsOf(parsed.error, t));
  if (!rateLimit(`mfa-verify:${userId}`, LIMITS.mfaVerify.limit, LIMITS.mfaVerify.windowMs).ok) return fail(t, "rate_limited");

  const factors = await listVerifiedFactors(supabase);
  let lastError: { code?: string; status?: number } = {};
  for (const factor of factors) {
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data.code });
    if (!error) return { ok: true };
    lastError = error;
    if (isRateLimitError(error)) break;
  }
  await logSecurityEvent({ user: { id: userId } }, { action: "security.mfa_failed", resourceType: "user", resourceId: userId });
  return codeError(t, lastError);
}

/** Remove one device. A current code (from any device) is required, even in an upgraded session. */
export async function removeFactor(supabase: UserSupabaseClient, userId: string, t: Dictionary, input: unknown): Promise<ActionResult> {
  const parsed = mfaFactorCodeSchema.safeParse(input);
  if (!parsed.success) return fail(t, "validation", undefined, fieldErrorsOf(parsed.error, t));
  const factors = await listVerifiedFactors(supabase);
  if (!factors.some((f) => f.id === parsed.data.factorId)) return fail(t, "not_found");

  const verified = await verifySignIn(supabase, userId, t, { code: parsed.data.code });
  if (!verified.ok) return verified;

  const { error } = await supabase.auth.mfa.unenroll({ factorId: parsed.data.factorId });
  if (error) {
    logServerError("mfa.unenroll", error);
    return fail(t, "internal");
  }
  const remaining = factors.length - 1;
  await logSecurityEvent(
    { user: { id: userId } },
    { action: remaining === 0 ? "security.mfa_disabled" : "security.mfa_device_removed", resourceType: "user", resourceId: userId },
  );
  return { ok: true, message: remaining === 0 ? t.success.mfaDisabled : t.success.mfaDeviceRemoved };
}
