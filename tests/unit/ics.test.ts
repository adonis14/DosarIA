import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine } from "@/lib/ics";

describe("iCalendar writer", () => {
  it("escapes text values", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(escapeText("bell\u0007")).toBe("bell");
  });

  it("folds long lines at 75 octets without splitting UTF-8 characters", () => {
    const line = `SUMMARY:${"ș".repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) {
      expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(75);
      if (i > 0) expect(p.startsWith(" ")).toBe(true);
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("")).toBe(line);
  });

  it("writes all-day and timed events with CRLF line endings", () => {
    const ics = buildCalendar({
      name: "Test",
      now: new Date("2026-11-27T10:00:00Z"),
      events: [
        { uid: "d1@x", summary: "Termen confirmat — dosar 1/3/2026", date: "2026-12-31" },
        { uid: "h1@x", summary: "Termen de judecată", start: new Date("2026-12-12T07:30:00Z"), durationMinutes: 60, location: "Tribunalul București" },
      ],
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101");
    expect(ics).toContain("DTSTART:20261212T073000Z\r\nDURATION:PT60M");
    expect(ics).toContain("DTSTAMP:20261127T100000Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("an empty calendar is still valid", () => {
    const ics = buildCalendar({ name: "Gol", events: [] });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
