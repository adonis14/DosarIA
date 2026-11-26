/**
 * Minimal iCalendar (RFC 5545) writer for the private calendar feed.
 * Plain data in, text out; no I/O. Lines end in CRLF and are folded at 75
 * octets; text values are escaped.
 */

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  /** All-day event on this calendar date (YYYY-MM-DD). */
  date?: string;
  /** Or a timed event: start instant and duration in minutes. */
  start?: Date;
  durationMinutes?: number;
};

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** Fold a content line at 75 octets without splitting a UTF-8 character (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, "utf8");
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const utcStamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateValue = (isoDate: string) => isoDate.replace(/-/g, "");
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildCalendar(opts: { name: string; events: IcsEvent[]; now?: Date }): string {
  const stamp = utcStamp(opts.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DosarIA//Calendar//RO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    "X-WR-TIMEZONE:Europe/Bucharest",
    // Ask clients to refresh every few hours (Google decides on its own).
    "REFRESH-INTERVAL;VALUE=DURATION:PT4H",
    "X-PUBLISHED-TTL:PT4H",
  ];
  for (const e of opts.events) {
    lines.push("BEGIN:VEVENT", `UID:${escapeText(e.uid)}`, `DTSTAMP:${stamp}`);
    if (e.start) {
      lines.push(`DTSTART:${utcStamp(e.start)}`, `DURATION:PT${Math.max(1, Math.round(e.durationMinutes ?? 60))}M`);
    } else if (e.date) {
      lines.push(`DTSTART;VALUE=DATE:${dateValue(e.date)}`, `DTEND;VALUE=DATE:${dateValue(nextDay(e.date))}`);
    } else {
      throw new Error("an event needs a date or a start time");
    }
    lines.push(`SUMMARY:${escapeText(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
