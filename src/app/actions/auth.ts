"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocale } from "@/i18n";
import { getLocale, getT, setLocaleCookie } from "@/i18n/server";
import { serverEnv } from "@/lib/env";
import { fail, logServerError, type ActionResult } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { safeNextPath } from "@/lib/security/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAuthContext, getMfaPendingSession } from "@/server/context";
import { verifySignIn } from "@/server/mfa";
import {
  fieldErrorsOf,
  forgotPasswordSchema,
  formToObject,
  loginSchema,
  signupSchema,
  updatePasswordSchema,
} from "@/lib/validation";

async function clientIp(): Promise<string> {
  const h = await headers();
  // Trust X-Forwarded-For only as set by the hosting platform's proxy.
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const parsed = loginSchema.safeParse(formToObject(formData, ["email", "password", "next"]));
  if (!parsed.success) return fail(t, "validation", t.errors.loginMissing);

  const ip = await clientIp();
  if (
    !rateLimit(`login:ip:${ip}`, LIMITS.login.limit * 3, LIMITS.login.windowMs).ok ||
    !rateLimit(`login:email:${parsed.data.email}`, LIMITS.login.limit, LIMITS.login.windowMs).ok
  ) {
    return fail(t, "rate_limited");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    if (error?.code === "email_not_confirmed") {
      return fail(t, "forbidden", t.errors.emailNotConfirmed);
    }
    // Same message for unknown email and wrong password (no account enumeration).
    return fail(t, "unauthenticated", t.errors.badCredentials);
  }
  const next = safeNextPath(parsed.data.next);
  // Two-step verification on: a password-only session sees no data until the code is entered.
  if ((data.user.factors ?? []).some((f) => f.status === "verified")) {
    redirect(`/auth/mfa?next=${encodeURIComponent(next)}`);
  }
  await syncLocaleAfterLogin(supabase, data.user.id);
  redirect(next);
}

/** Second sign-in step: the 6-digit code from the authenticator app. */
export async function mfaSignInAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const session = await getMfaPendingSession();
  if (!session) {
    // Already upgraded (e.g. a second tab) or signed out.
    if (await getAuthContext()) redirect("/dashboard");
    return fail(t, "unauthenticated");
  }
  if (!rateLimit(`mfa:ip:${await clientIp()}`, LIMITS.mfaVerify.limit * 4, LIMITS.mfaVerify.windowMs).ok) {
    return fail(t, "rate_limited");
  }
  const result = await verifySignIn(session.supabase, session.user.id, t, formToObject(formData, ["code"]));
  if (!result.ok) return result;
  await syncLocaleAfterLogin(session.supabase, session.user.id);
  const next = formData.get("next");
  redirect(safeNextPath(typeof next === "string" ? next : null));
}

/**
 * Restore the user's saved interface language, or save the current one if
 * none is stored yet. Best effort: a failure never blocks sign-in.
 */
async function syncLocaleAfterLogin(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, userId: string) {
  try {
    const { data } = await supabase.from("profiles").select("preferred_locale").eq("id", userId).maybeSingle();
    if (isLocale(data?.preferred_locale)) {
      await setLocaleCookie(data.preferred_locale);
    } else {
      await supabase.from("profiles").update({ preferred_locale: await getLocale() }).eq("id", userId);
    }
  } catch (e) {
    logServerError("syncLocaleAfterLogin", e);
  }
}

export async function signupAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const parsed = signupSchema.safeParse(formToObject(formData, ["email", "password", "fullName"]));
  if (!parsed.success) return fail(t, "validation", undefined, fieldErrorsOf(parsed.error, t));

  if (!rateLimit(`signup:${await clientIp()}`, LIMITS.signup.limit, LIMITS.signup.windowMs).ok) {
    return fail(t, "rate_limited");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${serverEnv().APP_URL}/auth/confirm?next=/onboarding`,
      // Display name only; never used for authorization.
      data: { full_name: parsed.data.fullName },
    },
  });
  if (error) {
    if (error.code === "weak_password") {
      return fail(t, "validation", t.errors.weakPassword, { password: [t.errors.weakPassword] });
    }
    if (error.code === "over_email_send_rate_limit") return fail(t, "rate_limited");
    logServerError("signUp", error);
    // Fall through to the generic response so existing accounts are not revealed.
  }
  redirect("/auth/check-email");
}

export async function forgotPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const parsed = forgotPasswordSchema.safeParse(formToObject(formData, ["email"]));
  if (!parsed.success) return fail(t, "validation", undefined, fieldErrorsOf(parsed.error, t));

  if (
    !rateLimit(`reset:${await clientIp()}`, LIMITS.passwordReset.limit, LIMITS.passwordReset.windowMs).ok ||
    !rateLimit(`reset:email:${parsed.data.email}`, 3, LIMITS.passwordReset.windowMs).ok
  ) {
    return fail(t, "rate_limited");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${serverEnv().APP_URL}/auth/confirm?next=/update-password`,
  });
  if (error && error.code !== "over_email_send_rate_limit") logServerError("resetPasswordForEmail", error);
  // Always the same answer, whether or not the account exists.
  return { ok: true, message: t.success.resetRequested };
}

export async function updatePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const t = await getT();
  const parsed = updatePasswordSchema.safeParse(formToObject(formData, ["password", "confirmPassword"]));
  if (!parsed.success) return fail(t, "validation", undefined, fieldErrorsOf(parsed.error, t));

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail(t, "unauthenticated");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "reauthentication_needed") {
      return fail(t, "forbidden", t.errors.reauthNeeded);
    }
    if (error.code === "same_password") return fail(t, "validation", t.errors.samePassword);
    if (error.code === "weak_password") return fail(t, "validation", t.errors.weakPassword);
    logServerError("updateUser.password", error);
    return fail(t, "internal");
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
