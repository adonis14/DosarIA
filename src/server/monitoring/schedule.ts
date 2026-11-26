import { addDays, bucharestInstant, bucharestParts, isWorkingDay } from "./calendar-ro";

/**
 * When should a court file be checked next? Pure and deterministic: the same
 * input always gives the same answer, so every rule is unit-tested.
 *
 * Rules (Europe/Bucharest wall-clock time):
 *   regular          07:30 and 18:00 on working days; criminal files every day
 *                    (courts can publish criminal decisions at weekends).
 *   after_hearing    on the day of a hearing that has no result yet: from the
 *                    (estimated) hearing time + 3 h until 22:00, every 30 min.
 *                    Results are usually posted after the judge has heard the
 *                    whole list, late in the day.
 *   awaiting_result  the next 2 checking days if there is still no result:
 *                    08:00–20:00, every 60 min.
 *   retry            after a failed, unavailable or incomplete check: again
 *                    within 60 min (or sooner if a planned slot comes first).
 *
 * A file never waits longer than its next regular slot, and never less than
 * the source's minimum interval between two checks of the same file.
 */

export const SCHEDULE = {
  regularSlots: [7 * 60 + 30, 18 * 60],
  afterHearingDelayMinutes: 3 * 60,
  defaultHearingTime: 11 * 60,
  afterHearingEnd: 22 * 60,
  afterHearingIntervalMinutes: 30,
  awaitingDays: 2,
  awaitingStart: 8 * 60,
  awaitingEnd: 20 * 60,
  awaitingIntervalMinutes: 60,
  retryMinutes: 60,
  /** Hearings older than this are ignored for the hot windows. */
  lookbackDays: 7,
} as const;

export type NextCheckReason = "regular" | "after_hearing" | "awaiting_result" | "retry";

export type ScheduleHearing = {
  date: string;
  time: string | null;
  solutionType: string | null;
};

export type PlanInput = {
  now: Date;
  /** cases.matter_type */
  matterType: string;
  /** Hearings from the latest COMPLETE snapshot (null if there is none). */
  hearings: ScheduleHearing[] | null;
  /** Outcome of the check that just ran (or the case's last outcome). */
  lastOutcome: string;
  /** When the last check attempt finished, for the source's minimum interval. */
  lastAttemptAt?: Date | null;
  minIntervalMs?: number;
};

export type Plan = { at: Date; reason: NextCheckReason };

const MINUTE = 60_000;
const RETRY_OUTCOMES = new Set(["failed", "source_unavailable", "incomplete"]);

function parseTime(value: string | null): number | null {
  const m = value?.match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Days on which a file of this matter type is checked at all. */
function isCheckingDay(date: string, matterType: string): boolean {
  return matterType === "criminal" || isWorkingDay(date);
}

/** First tick of a [start, end] window, every `interval` minutes, strictly after `now`. */
function nextTickInWindow(date: string, start: number, end: number, interval: number, now: Date): Date | null {
  const startAt = bucharestInstant(date, start);
  const endAt = bucharestInstant(date, end);
  if (now < startAt) return startAt;
  if (now >= endAt) return null;
  const next = new Date(now.getTime() + interval * MINUTE);
  return next <= endAt ? next : null;
}

function nextRegular(now: Date, matterType: string): Date {
  const today = bucharestParts(now).date;
  for (let i = 0; i < 30; i++) {
    const date = addDays(today, i);
    if (!isCheckingDay(date, matterType)) continue;
    for (const slot of SCHEDULE.regularSlots) {
      const at = bucharestInstant(date, slot);
      if (at > now) return at;
    }
  }
  // Unreachable in practice (there is always a working day within 30 days).
  return new Date(now.getTime() + 12 * 60 * MINUTE);
}

export function planNextCheck(input: PlanInput): Plan {
  const { now, matterType } = input;
  const today = bucharestParts(now).date;
  const candidates: Plan[] = [{ at: nextRegular(now, matterType), reason: "regular" }];

  for (const h of input.hearings ?? []) {
    if (h.solutionType !== null) continue; // result already published
    if (h.date < addDays(today, -SCHEDULE.lookbackDays)) continue;

    const hearingTime = parseTime(h.time) ?? SCHEDULE.defaultHearingTime;
    const start = Math.min(hearingTime + SCHEDULE.afterHearingDelayMinutes, SCHEDULE.afterHearingEnd);
    const hot = nextTickInWindow(h.date, start, SCHEDULE.afterHearingEnd, SCHEDULE.afterHearingIntervalMinutes, now);
    if (hot) candidates.push({ at: hot, reason: "after_hearing" });

    // The next checking days after the hearing, if the result is still missing.
    let day = h.date;
    for (let n = 0; n < SCHEDULE.awaitingDays; ) {
      day = addDays(day, 1);
      if (!isCheckingDay(day, matterType)) continue;
      n++;
      const tick = nextTickInWindow(
        day,
        SCHEDULE.awaitingStart,
        SCHEDULE.awaitingEnd,
        SCHEDULE.awaitingIntervalMinutes,
        now,
      );
      if (tick) {
        candidates.push({ at: tick, reason: "awaiting_result" });
        break;
      }
    }
  }

  if (RETRY_OUTCOMES.has(input.lastOutcome)) {
    candidates.push({ at: new Date(now.getTime() + SCHEDULE.retryMinutes * MINUTE), reason: "retry" });
  }

  const best = candidates.reduce((a, b) => (b.at < a.at ? b : a));

  // Never sooner than the source allows for one file.
  if (input.minIntervalMs && input.lastAttemptAt) {
    const earliest = new Date(input.lastAttemptAt.getTime() + input.minIntervalMs);
    if (best.at < earliest) return { at: earliest, reason: best.reason };
  }
  return best;
}
