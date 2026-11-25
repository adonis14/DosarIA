import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, type Locale } from "./config";
import { getDictionary, resolveLocale, type Dictionary } from "./index";

/** The interface language for this request (cookie; English by default). */
export const getLocale = cache(async (): Promise<Locale> => {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
});

export async function getT(): Promise<Dictionary> {
  return getDictionary(await getLocale());
}

/** Persist the interface language in an HttpOnly cookie (presentation only; never used for authorization). */
export async function setLocaleCookie(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
