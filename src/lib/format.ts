const TZ = "Europe/Bucharest";

const dateFmt = new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TZ,
});

/** YYYY-MM-DD (calendar date, no time zone) → "19 decembrie 2026". */
export function formatDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

/** Timestamp → local Bucharest date and time. */
export function formatDateTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

export function daysUntil(isoDate: string, today = new Date()): number {
  const target = Date.parse(`${isoDate}T00:00:00Z`);
  const base = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((target - base) / 86_400_000);
}
