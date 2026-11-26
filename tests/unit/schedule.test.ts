import { describe, expect, it } from "vitest";
import {
  bucharestInstant,
  bucharestParts,
  isWorkingDay,
  orthodoxEaster,
  romanianPublicHolidays,
} from "@/server/monitoring/calendar-ro";
import { planNextCheck, type PlanInput } from "@/server/monitoring/schedule";

// Winter: Bucharest is UTC+2, so 07:30 local = 05:30Z, 14:00 local = 12:00Z, 18:00 local = 16:00Z.
const at = (iso: string) => new Date(iso);
const plan = (over: Partial<PlanInput> & Pick<PlanInput, "now">) =>
  planNextCheck({ matterType: "civil", hearings: [], lastOutcome: "no_changes", ...over });

describe("Romanian calendar", () => {
  it("computes Orthodox Easter", () => {
    expect(orthodoxEaster(2024)).toBe("2024-05-05");
    expect(orthodoxEaster(2025)).toBe("2025-04-20");
    expect(orthodoxEaster(2026)).toBe("2026-04-12");
    expect(orthodoxEaster(2027)).toBe("2027-05-02");
  });

  it("lists the legal public holidays, including the movable ones", () => {
    const h = romanianPublicHolidays(2026);
    for (const d of ["2026-01-06", "2026-01-07", "2026-04-10", "2026-04-13", "2026-05-31", "2026-06-01", "2026-11-30", "2026-12-01"]) {
      expect(h.has(d), d).toBe(true);
    }
    // 17 holidays, but in 2026 Rusalii Monday falls on 1 June (Children's Day): 16 dates.
    expect(h.size).toBe(16);
    expect(romanianPublicHolidays(2027).size).toBe(17);
  });

  it("knows working days", () => {
    expect(isWorkingDay("2026-11-27")).toBe(true); // Friday
    expect(isWorkingDay("2026-11-28")).toBe(false); // Saturday
    expect(isWorkingDay("2026-11-30")).toBe(false); // Sf. Andrei
    expect(isWorkingDay("2026-12-01")).toBe(false); // Ziua Națională
    expect(isWorkingDay("2026-12-02")).toBe(true);
  });

  it("converts Bucharest wall-clock time across daylight-saving changes", () => {
    expect(bucharestInstant("2026-01-15", 7 * 60 + 30).toISOString()).toBe("2026-01-15T05:30:00.000Z");
    expect(bucharestInstant("2026-03-29", 7 * 60 + 30).toISOString()).toBe("2026-03-29T04:30:00.000Z"); // summer time from 03:00
    expect(bucharestInstant("2026-10-25", 7 * 60 + 30).toISOString()).toBe("2026-10-25T05:30:00.000Z"); // back to winter time
    expect(bucharestParts(at("2026-07-01T21:30:00Z"))).toEqual({ date: "2026-07-02", minutes: 30 });
  });
});

describe("planNextCheck", () => {
  it("regular: morning and evening on working days", () => {
    expect(plan({ now: at("2026-11-26T08:00:00Z") })).toEqual({ at: at("2026-11-26T16:00:00Z"), reason: "regular" });
    expect(plan({ now: at("2026-11-26T16:00:00Z") })).toEqual({ at: at("2026-11-27T05:30:00Z"), reason: "regular" });
  });

  it("regular: skips weekends and public holidays for civil files", () => {
    // Friday evening → Sat, Sun, Mon 30 Nov and Tue 1 Dec are all non-working → Wednesday 07:30.
    expect(plan({ now: at("2026-11-27T17:00:00Z") })).toEqual({ at: at("2026-12-02T05:30:00Z"), reason: "regular" });
  });

  it("regular: criminal files are checked every day", () => {
    expect(plan({ now: at("2026-11-27T17:00:00Z"), matterType: "criminal" })).toEqual({
      at: at("2026-11-28T05:30:00Z"),
      reason: "regular",
    });
  });

  const hearingToday = [{ date: "2026-11-26", time: "11:00", solutionType: null }];

  it("after a hearing: starts at hearing time + 3 h", () => {
    expect(plan({ now: at("2026-11-26T07:00:00Z"), hearings: hearingToday })).toEqual({
      at: at("2026-11-26T12:00:00Z"),
      reason: "after_hearing",
    });
  });

  it("after a hearing: every 30 minutes until the result appears", () => {
    expect(plan({ now: at("2026-11-26T13:10:00Z"), hearings: hearingToday })).toEqual({
      at: at("2026-11-26T13:40:00Z"),
      reason: "after_hearing",
    });
  });

  it("after a hearing: a hearing without a time starts at 14:00", () => {
    expect(plan({ now: at("2026-11-26T07:00:00Z"), hearings: [{ date: "2026-11-26", time: null, solutionType: null }] })).toEqual(
      { at: at("2026-11-26T12:00:00Z"), reason: "after_hearing" },
    );
  });

  it("after a hearing: back to regular once the result is published", () => {
    expect(
      plan({ now: at("2026-11-26T13:10:00Z"), hearings: [{ ...hearingToday[0], solutionType: "postponement" }] }),
    ).toEqual({ at: at("2026-11-26T16:00:00Z"), reason: "regular" });
  });

  it("no result by 22:00: hourly the next checking days (regular slot first if earlier)", () => {
    // 22:05 local → the 07:30 regular slot comes before the 08:00 awaiting window.
    expect(plan({ now: at("2026-11-26T20:05:00Z"), hearings: hearingToday })).toEqual({
      at: at("2026-11-27T05:30:00Z"),
      reason: "regular",
    });
    // Next day 08:10 local → 09:10 local.
    expect(plan({ now: at("2026-11-27T06:10:00Z"), hearings: hearingToday })).toEqual({
      at: at("2026-11-27T07:10:00Z"),
      reason: "awaiting_result",
    });
  });

  it("awaiting days skip non-working days for civil files, not for criminal ones", () => {
    const fridayHearing = [{ date: "2026-12-04", time: "10:00", solutionType: null }];
    const saturday10 = at("2026-12-05T08:00:00Z");
    expect(plan({ now: saturday10, hearings: fridayHearing })).toEqual({ at: at("2026-12-07T05:30:00Z"), reason: "regular" });
    expect(plan({ now: saturday10, hearings: fridayHearing, matterType: "criminal" })).toEqual({
      at: at("2026-12-05T09:00:00Z"),
      reason: "awaiting_result",
    });
  });

  it("ignores hearings older than the look-back window", () => {
    expect(
      plan({ now: at("2026-11-26T08:00:00Z"), hearings: [{ date: "2026-11-10", time: "09:00", solutionType: null }] }),
    ).toEqual({ at: at("2026-11-26T16:00:00Z"), reason: "regular" });
  });

  it("retries a failed, unavailable or incomplete check within the hour", () => {
    for (const lastOutcome of ["failed", "source_unavailable", "incomplete"]) {
      expect(plan({ now: at("2026-11-26T08:00:00Z"), lastOutcome })).toEqual({ at: at("2026-11-26T09:00:00Z"), reason: "retry" });
    }
  });

  it("never checks a file sooner than the source's minimum interval", () => {
    const now = at("2026-11-26T13:10:00Z");
    expect(
      plan({ now, hearings: hearingToday, lastAttemptAt: now, minIntervalMs: 60 * 60_000 }),
    ).toEqual({ at: at("2026-11-26T14:10:00Z"), reason: "after_hearing" });
  });
});
