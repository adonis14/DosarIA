import type { Locale } from "@/i18n/config";
import { formatDate } from "@/lib/format";

/**
 * Draft note for the client about one court update — template only, no AI.
 *
 * - The court's own wording is quoted exactly, never reworded.
 * - The draft is shown to the lawyer, who edits it and sends it themselves.
 *   DosarIA never sends anything to a client and does not store the draft.
 * - No deadline is stated or calculated. For a ruling, the note only says that
 *   any appeal time limit usually runs from the communication of the ruling.
 */

export type ClientNoteInput = {
  eventType: string;
  details: Record<string, string | null | undefined>;
  occurredOn: string | null;
  caseNumber: string;
  courtName: string;
  /** Name for the signature (the lawyer preparing the note). */
  signer: string | null;
};

type Texts = {
  greeting: string;
  intro: (number: string, court: string) => string;
  decision: (date: string) => string;
  decisionNoText: (date: string) => string;
  decisionNext: string;
  postponed: (date: string) => string;
  nextHearing: (date: string) => string;
  noNewDate: string;
  courtWording: string;
  rescheduled: (date: string) => string;
  scheduled: (date: string, time: string | null) => string;
  statusChanged: (to: string) => string;
  stageChanged: (to: string) => string;
  closing: string;
  signOff: string;
};

const RO: Texts = {
  greeting: "Bună ziua,",
  intro: (n, c) => `Vă informăm că în dosarul nr. ${n} (${c}), `,
  decision: (d) => `la termenul din ${d}, instanța a pronunțat următoarea soluție:`,
  decisionNoText: (d) => `la termenul din ${d}, instanța a pronunțat o hotărâre.`,
  decisionNext:
    "Vom analiza hotărârea și vă vom comunica pașii următori. Termenul pentru o eventuală cale de atac curge, de regulă, de la comunicarea hotărârii; vă vom anunța când o primim.",
  postponed: (d) => `la termenul din ${d}, instanța a amânat judecarea cauzei.`,
  nextHearing: (d) => `Următorul termen de judecată este ${d}.`,
  noNewDate: "Noul termen nu a fost încă publicat; vă vom anunța de îndată ce îl aflăm.",
  courtWording: "Soluția publicată de instanță:",
  rescheduled: (d) => `termenul de judecată din ${d} a fost modificat.`,
  scheduled: (d, t) => `a fost stabilit un termen de judecată pentru ${d}${t ? `, ora ${t}` : ""}.`,
  statusChanged: (to) => `situația dosarului a fost actualizată: „${to}”.`,
  stageChanged: (to) => `dosarul a trecut în etapa „${to}”.`,
  closing: "Pentru orice întrebări, vă stăm la dispoziție.",
  signOff: "Cu stimă,",
};

const EN: Texts = {
  greeting: "Hello,",
  intro: (n, c) => `We would like to let you know that in case no. ${n} (${c}), `,
  decision: (d) => `at the hearing of ${d}, the court issued the following ruling (the court's wording, in Romanian):`,
  decisionNoText: (d) => `at the hearing of ${d}, the court issued a ruling.`,
  decisionNext:
    "We will review the ruling and let you know the next steps. Any time limit for an appeal usually runs from the date the ruling is communicated; we will tell you when we receive it.",
  postponed: (d) => `at the hearing of ${d}, the court adjourned the case.`,
  nextHearing: (d) => `The next hearing is on ${d}.`,
  noNewDate: "The new hearing date has not been published yet; we will let you know as soon as we have it.",
  courtWording: "The court's published wording (in Romanian):",
  rescheduled: (d) => `the hearing of ${d} has been moved.`,
  scheduled: (d, t) => `a hearing has been set for ${d}${t ? ` at ${t}` : ""}.`,
  statusChanged: (to) => `the status of the case has been updated: “${to}”.`,
  stageChanged: (to) => `the case has moved to the stage “${to}”.`,
  closing: "Please let us know if you have any questions.",
  signOff: "Kind regards,",
};

const quote = (text: string, lang: Locale) => (lang === "ro" ? `„${text}”` : `“${text}”`);

/** The draft, or null when the update has nothing a client needs to hear. */
export function buildClientNote(input: ClientNoteInput, lang: Locale): string | null {
  const t = lang === "ro" ? RO : EN;
  const d = input.details;
  const date = (v: string | null | undefined) => formatDate(v ?? null, lang);
  const solution = d.solution_text?.trim() || null;

  const body: string[] = [];
  const opening = (clause: string) => body.push(t.intro(input.caseNumber, input.courtName) + clause);

  switch (input.eventType) {
    case "decision_issued": {
      const when = date(d.hearing_date ?? input.occurredOn);
      if (solution) {
        opening(t.decision(when));
        body.push(quote(solution, lang));
      } else {
        opening(t.decisionNoText(when));
      }
      body.push(t.decisionNext);
      break;
    }
    case "hearing_postponed":
      opening(t.postponed(date(d.previous_date)) + " " + (d.new_date ? t.nextHearing(date(d.new_date)) : t.noNewDate));
      if (solution) body.push(`${t.courtWording} ${quote(solution, lang)}`);
      break;
    case "hearing_rescheduled":
      opening(t.rescheduled(date(d.previous_date)) + " " + (d.new_date ? t.nextHearing(date(d.new_date)) : t.noNewDate));
      break;
    case "hearing_scheduled":
      if (!d.hearing_date) return null;
      opening(t.scheduled(date(d.hearing_date), d.hearing_time ?? null));
      break;
    case "status_changed":
      if (!d.to) return null;
      opening(t.statusChanged(d.to));
      break;
    case "stage_changed":
      if (!d.to) return null;
      opening(t.stageChanged(d.to));
      break;
    case "monitoring_started":
      if (!d.next_hearing_date) return null;
      opening(t.nextHearing(date(d.next_hearing_date)).replace(/^./, (c) => c.toLowerCase()));
      break;
    default:
      return null;
  }

  return [t.greeting, "", ...body.flatMap((p) => [p, ""]), t.closing, "", t.signOff, input.signer ?? ""].join("\n").trimEnd();
}
