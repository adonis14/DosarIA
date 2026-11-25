"use server";

import { z } from "zod";
import { LOCALES } from "@/i18n";
import { setLocaleCookie } from "@/i18n/server";
import { logServerError } from "@/lib/errors";
import { getAuthContext } from "@/server/context";

const localeSchema = z.enum(LOCALES);

/**
 * Switch the interface language. The cookie drives rendering; for signed-in
 * users the choice is also saved to their own profile (RLS: self only;
 * column grant: preferred_locale only) so it follows them to other browsers.
 * The page re-renders in the new language after the action completes.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const parsed = localeSchema.safeParse(formData.get("locale"));
  if (!parsed.success) return;
  await setLocaleCookie(parsed.data);

  const ctx = await getAuthContext();
  if (!ctx) return;
  const { error } = await ctx.supabase.from("profiles").update({ preferred_locale: parsed.data }).eq("id", ctx.user.id);
  if (error) logServerError("setLocale", error);
}
