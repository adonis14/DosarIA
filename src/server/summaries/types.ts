import type { DetectedEvent } from "@/server/monitoring/diff";

export type EventSummary = {
  ro: string;
  en: string;
  source: "deterministic_template" | "llm";
};

/**
 * Produces a short, factual description of a detected court event.
 * Summaries describe what the source reported; they are NOT legal advice and
 * never compute or assert procedural deadlines.
 */
export interface SummaryProvider {
  readonly id: EventSummary["source"];
  summarize(event: DetectedEvent): Promise<EventSummary>;
}
