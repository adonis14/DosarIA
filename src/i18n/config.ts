/**
 * Supported interface languages. Romanian is the default: it is the language
 * of the courts, of the published court data and of the users (lawyers
 * practising in Romania). English is available through the language switch.
 *
 * The chosen language is stored in a cookie (read on every request) and, for
 * signed-in users, in profiles.preferred_locale so it follows the user to a
 * new browser. The locale only affects presentation; it is never used for
 * authorization.
 */
export const LOCALES = ["en", "ro"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ro";
export const LOCALE_COOKIE = "dosaria_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** BCP 47 tag used for Intl date formatting. */
export const INTL_LOCALE: Record<Locale, string> = { en: "en-GB", ro: "ro-RO" };

/** Replace `{name}` placeholders (used for strings that must stay serializable, e.g. client messages). */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
