"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { serverEnv } from "@/lib/env";
import { fail, logServerError, type ActionResult } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { safeNextPath } from "@/lib/security/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  const parsed = loginSchema.safeParse(formToObject(formData, ["email", "password", "next"]));
  if (!parsed.success) return fail("validation", "Introduceți adresa de e-mail și parola.");

  const ip = await clientIp();
  if (
    !rateLimit(`login:ip:${ip}`, LIMITS.login.limit * 3, LIMITS.login.windowMs).ok ||
    !rateLimit(`login:email:${parsed.data.email}`, LIMITS.login.limit, LIMITS.login.windowMs).ok
  ) {
    return fail("rate_limited");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return fail("forbidden", "Adresa de e-mail nu a fost confirmată. Verificați mesajul primit la înregistrare.");
    }
    // Same message for unknown email and wrong password (no account enumeration).
    return fail("unauthenticated", "E-mail sau parolă incorectă.");
  }
  redirect(safeNextPath(parsed.data.next));
}

export async function signupAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(formToObject(formData, ["email", "password", "fullName"]));
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));

  if (!rateLimit(`signup:${await clientIp()}`, LIMITS.signup.limit, LIMITS.signup.windowMs).ok) {
    return fail("rate_limited");
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
      return fail("validation", "Parola nu respectă cerințele de securitate.", { password: [error.message] });
    }
    if (error.code === "over_email_send_rate_limit") return fail("rate_limited");
    logServerError("signUp", error);
    // Fall through to the generic response so existing accounts are not revealed.
  }
  redirect("/auth/check-email");
}

export async function forgotPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(formToObject(formData, ["email"]));
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));

  if (
    !rateLimit(`reset:${await clientIp()}`, LIMITS.passwordReset.limit, LIMITS.passwordReset.windowMs).ok ||
    !rateLimit(`reset:email:${parsed.data.email}`, 3, LIMITS.passwordReset.windowMs).ok
  ) {
    return fail("rate_limited");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${serverEnv().APP_URL}/auth/confirm?next=/update-password`,
  });
  if (error && error.code !== "over_email_send_rate_limit") logServerError("resetPasswordForEmail", error);
  // Always the same answer, whether or not the account exists.
  return { ok: true, message: "Dacă adresa există în sistem, veți primi un e-mail cu instrucțiuni de resetare." };
}

export async function updatePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = updatePasswordSchema.safeParse(formToObject(formData, ["password", "confirmPassword"]));
  if (!parsed.success) return fail("validation", undefined, fieldErrorsOf(parsed.error));

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("unauthenticated");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "reauthentication_needed") {
      return fail("forbidden", "Din motive de securitate, solicitați un link de resetare a parolei și încercați din nou.");
    }
    if (error.code === "same_password") return fail("validation", "Parola nouă trebuie să fie diferită de cea actuală.");
    if (error.code === "weak_password") return fail("validation", "Parola nu respectă cerințele de securitate.");
    logServerError("updateUser.password", error);
    return fail("internal");
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
