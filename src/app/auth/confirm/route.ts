import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNextPath } from "@/lib/security/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const ALLOWED_TYPES: EmailOtpType[] = ["email", "signup", "recovery", "email_change"];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * Email link landing (sign-up confirmation, password recovery).
 * The one-time token hash is verified server-side; the resulting session is
 * written to HttpOnly cookies. `next` is restricted to same-origin paths.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/dashboard");

  const supabase = await createSupabaseServerClient();
  let ok = false;

  if (tokenHash && type && ALLOWED_TYPES.includes(type) && TOKEN_PATTERN.test(tokenHash)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code && TOKEN_PATTERN.test(code)) {
    // PKCE fallback (links produced by default Supabase templates).
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  redirect(ok ? next : "/auth/error");
}
