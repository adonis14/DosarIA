/**
 * Romanian calendar helpers: Europe/Bucharest wall-clock time and public
 * holidays (non-working days).
 *
 * USED FOR CHECK SCHEDULING ONLY. A mistake here changes how often a file is
 * checked, never a legal deadline. Before this list is reused for procedural
 * deadline calculation it must be verified by a lawyer against the current
 * Labour Code (art. 139) and any one-off government decisions.
 */

export const BUCHAREST = "Europe/Bucharest";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUCHAREST,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: BUCHAREST, timeZoneName: "longOffset" });

/** Local Bucharest date (YYYY-MM-DD) and minutes since local midnight for an instant. */
export function bucharestParts(instant: Date): { date: string; minutes: number } {
  const p = Object.fromEntries(partsFormatter.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function offsetMinutes(instant: Date): number {
  const tz = offsetFormatter.formatToParts(instant).find((p) => p.type === "timeZoneName")?.value ?? "GMT+02:00";
  const m = tz.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0; // "GMT" exactly
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** The instant at which Bucharest wall-clock shows `date` + `minutes` (DST-aware). */
export function bucharestInstant(date: string, minutes: number): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, mo - 1, d, Math.floor(minutes / 60), minutes % 60);
  let guess = naive - offsetMinutes(new Date(naive)) * 60_000;
  // A second pass settles the offset when the first guess straddled a DST change.
  guess = naive - offsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Orthodox Easter Sunday (Gregorian date), valid 1900–2099 (Meeus' Julian algorithm + 13 days). */
export function orthodoxEaster(year: number): string {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julian = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return addDays(julian, 13);
}

const holidayCache = new Map<number, Set<string>>();

/** Romanian legal public holidays for a year (Labour Code art. 139, as amended in 2023). */
export function romanianPublicHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const y = String(year);
  const easter = orthodoxEaster(year);
  const days = new Set<string>([
    `${y}-01-01`,
    `${y}-01-02`,
    `${y}-01-06`, // Boboteaza
    `${y}-01-07`, // Sf. Ioan Botezătorul
    `${y}-01-24`, // Unirea Principatelor
    addDays(easter, -2), // Good Friday
    easter,
    addDays(easter, 1),
    `${y}-05-01`,
    `${y}-06-01`,
    addDays(easter, 49), // Rusalii (Pentecost)
    addDays(easter, 50),
    `${y}-08-15`,
    `${y}-11-30`,
    `${y}-12-01`,
    `${y}-12-25`,
    `${y}-12-26`,
  ]);
  holidayCache.set(year, days);
  return days;
}

/** Monday–Friday and not a public holiday. */
export function isWorkingDay(date: string): boolean {
  const wd = weekday(date);
  if (wd === 0 || wd === 6) return false;
  return !romanianPublicHolidays(Number(date.slice(0, 4))).has(date);
}
