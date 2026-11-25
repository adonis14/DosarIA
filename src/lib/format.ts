import { INTL_LOCALE, type Locale } from "@/i18n/config";

const TZ = "Europe/Bucharest";

const dateFormatters = new Map<Locale, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<Locale, Intl.DateTimeFormat>();

function dateFmt(locale: Locale): Intl.DateTimeFormat {
  let f = dateFormatters.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_LOCALE[locale], { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
    dateFormatters.set(locale, f);
  }
  return f;
}

function dateTimeFmt(locale: Locale): Intl.DateTimeFormat {
  let f = dateTimeFormatters.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TZ,
    });
    dateTimeFormatters.set(locale, f);
  }
  return f;
}

/** YYYY-MM-DD (calendar date, no time zone) → "19 December 2026" / "19 decembrie 2026". */
export function formatDate(isoDate: string | null | undefined, locale: Locale): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt(locale).format(d);
}

/** Timestamp → local Bucharest date and time (court time), in the interface language. */
export function formatDateTime(timestamp: string | null | undefined, locale: Locale): string {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt(locale).format(d);
}

export function daysUntil(isoDate: string, today = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const base = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - base) / 86_400_000);
}
