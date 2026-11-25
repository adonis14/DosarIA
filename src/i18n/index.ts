import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";
import { en, type Dictionary } from "./dictionaries/en";
import { ro } from "./dictionaries/ro";

export type { Dictionary } from "./dictionaries/en";
export * from "./config";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ro };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** Resolve an untrusted value (cookie, form field, DB column) to a supported locale. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Look up a label for an enum-like key; unknown keys are shown as-is. */
export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key;
}
