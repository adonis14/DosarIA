import { canonicalHash } from "./canonical";
import type { NormalizedCase, NormalizedHearing } from "./normalize";

/**
 * Change detection between two COMPLETE normalized snapshots.
 *
 * Event keys are canonical hashes of the facts an event asserts, so
 * re-detecting the same fact (a double click, a retried request, a source
 * that briefly drops and re-adds a hearing) never produces a duplicate row:
 * the database enforces UNIQUE (case_id, event_key).
 */

export type DetectedEventType =
  | "monitoring_started"
  | "hearing_scheduled"
  | "hearing_rescheduled"
  | "hearing_postponed"
  | "decision_issued"
  | "status_changed"
  | "stage_changed";

export type DetectedEvent = {
  type: DetectedEventType;
  eventKey: string;
  /** Court date the event refers to (YYYY-MM-DD), if any. */
  occurredOn: string | null;
  /** Minimal, non-personal facts used for display and summaries. */
  details: Record<string, string | null>;
  requiresReview: boolean;
  /** A date worth tracking (e.g. a new hearing). Always a *suggestion*. */
  suggestedReminderDate: string | null;
};

type DiffContext = {
  /** Content hash of the previous complete snapshot, or null for a baseline. */
  previousHash: string | null;
  /** YYYY-MM-DD of the fetch, used to decide which hearings are upcoming. */
  today: string;
};

const keyOf = (fact: Record<string, unknown>) => canonicalHash(fact);
const hearingId = (h: NormalizedHearing) => `${h.date}T${h.time ?? ""}`;

export function nextUpcomingHearing(c: Pick<NormalizedCase, "hearings">, today: string): NormalizedHearing | null {
  return c.hearings.find((h) => h.solutionType === null && h.date >= today) ?? null;
}

export function detectChanges(
  previous: NormalizedCase | null,
  next: NormalizedCase,
  ctx: DiffContext,
): DetectedEvent[] {
  if (previous === null) {
    const upcoming = nextUpcomingHearing(next, ctx.today);
    return [
      {
        type: "monitoring_started",
        eventKey: keyOf({ type: "monitoring_started" }),
        occurredOn: null,
        details: {
          status: next.status,
          stage: next.stage,
          next_hearing_date: upcoming?.date ?? null,
        },
        requiresReview: false,
        suggestedReminderDate: upcoming?.date ?? null,
      },
    ];
  }

  const events: DetectedEvent[] = [];
  const prevById = new Map(previous.hearings.map((h) => [hearingId(h), h]));
  const nextById = new Map(next.hearings.map((h) => [hearingId(h), h]));

  const added = next.hearings.filter((h) => !prevById.has(hearingId(h)));
  const removedPending = previous.hearings.filter((h) => !nextById.has(hearingId(h)) && h.solutionType === null);
  const consumed = new Set<string>();

  // 1. Hearings that received a solution.
  for (const h of next.hearings) {
    const before = prevById.get(hearingId(h));
    if (!before || before.solutionType !== null || h.solutionType === null) continue;

    if (h.solutionType === "postponement") {
      const newHearing = added.find((a) => a.date > h.date && !consumed.has(hearingId(a))) ?? null;
      if (newHearing) consumed.add(hearingId(newHearing));
      events.push({
        type: "hearing_postponed",
        eventKey: keyOf({ type: "hearing_postponed", date: h.date, new_date: newHearing?.date ?? null }),
        occurredOn: newHearing?.date ?? h.date,
        details: {
          previous_date: h.date,
          new_date: newHearing?.date ?? null,
          solution_text: h.solutionText,
        },
        requiresReview: newHearing === null,
        suggestedReminderDate: newHearing?.date ?? null,
      });
    } else {
      events.push({
        type: "decision_issued",
        eventKey: keyOf({ type: "decision_issued", date: h.date, solution: h.solutionText }),
        occurredOn: h.date,
        details: {
          hearing_date: h.date,
          solution_text: h.solutionText,
          document_reference: h.documentReference,
        },
        // Unrecognized solution wording is always routed to a human.
        requiresReview: h.solutionType === "other",
        suggestedReminderDate: null,
      });
    }
  }

  // 2. A pending hearing disappeared and another appeared: rescheduled.
  const remainingAdded = added.filter((a) => !consumed.has(hearingId(a)));
  for (const removed of removedPending) {
    const replacement = remainingAdded.find((a) => a.solutionType === null && !consumed.has(hearingId(a))) ?? null;
    if (replacement) consumed.add(hearingId(replacement));
    events.push({
      type: "hearing_rescheduled",
      eventKey: keyOf({ type: "hearing_rescheduled", previous_date: removed.date, new_date: replacement?.date ?? null }),
      occurredOn: replacement?.date ?? null,
      details: { previous_date: removed.date, new_date: replacement?.date ?? null },
      // A hearing that vanished without a replacement must be checked by a person.
      requiresReview: replacement === null,
      suggestedReminderDate: replacement?.date ?? null,
    });
  }

  // 3. Genuinely new hearings.
  for (const h of added) {
    if (consumed.has(hearingId(h)) || h.solutionType !== null) continue;
    events.push({
      type: "hearing_scheduled",
      eventKey: keyOf({ type: "hearing_scheduled", date: h.date, time: h.time }),
      occurredOn: h.date,
      details: { hearing_date: h.date, hearing_time: h.time, panel: h.panel },
      requiresReview: false,
      suggestedReminderDate: h.date >= ctx.today ? h.date : null,
    });
  }

  // 4. Case-level fields. The previous snapshot hash is part of the key so a
  //    legitimate A→B→A→B flip is recorded each time, while a re-detection of
  //    the same transition is not.
  if (previous.status !== next.status) {
    events.push({
      type: "status_changed",
      eventKey: keyOf({ type: "status_changed", from: previous.status, to: next.status, basis: ctx.previousHash }),
      occurredOn: null,
      details: { from: previous.status, to: next.status },
      requiresReview: false,
      suggestedReminderDate: null,
    });
  }
  if (previous.stage !== next.stage) {
    events.push({
      type: "stage_changed",
      eventKey: keyOf({ type: "stage_changed", from: previous.stage, to: next.stage, basis: ctx.previousHash }),
      occurredOn: null,
      details: { from: previous.stage, to: next.stage },
      requiresReview: false,
      suggestedReminderDate: null,
    });
  }

  return events;
}
