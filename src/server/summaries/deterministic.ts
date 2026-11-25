import { courtTermInline } from "@/i18n/court-terms";
import type { DetectedEvent } from "@/server/monitoring/diff";
import type { EventSummary, SummaryProvider } from "./types";

const roDate = new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const enDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function fmt(formatter: Intl.DateTimeFormat, iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return formatter.format(new Date(`${iso}T00:00:00Z`));
}

/** Court-supplied text is untrusted: collapse whitespace and cap its length. */
function quote(text: string | null | undefined, max = 280): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** English text keeps the court's original term next to the gloss: "First instance (Fond)". */
function enTerm(text: string | null | undefined): string | null {
  return courtTermInline(text, "en");
}

export function summarizeDeterministically(event: DetectedEvent): Omit<EventSummary, "source"> {
  const d = event.details;
  switch (event.type) {
    case "monitoring_started": {
      const ro = fmt(roDate, d.next_hearing_date);
      const en = fmt(enDate, d.next_hearing_date);
      return {
        ro: `Monitorizarea dosarului a început. Stadiu procesual: ${d.stage ?? "necunoscut"}; stare: ${d.status ?? "necunoscută"}.${ro ? ` Următorul termen de judecată afișat: ${ro}.` : " Nu este afișat niciun termen viitor."}`,
        en: `Monitoring of this case has started. Procedural stage: ${enTerm(d.stage) ?? "unknown"}; status: ${enTerm(d.status) ?? "unknown"}.${en ? ` Next hearing shown: ${en}.` : " No upcoming hearing is shown."}`,
      };
    }
    case "hearing_rescheduled": {
      const prevRo = fmt(roDate, d.previous_date);
      const prevEn = fmt(enDate, d.previous_date);
      const nextRo = fmt(roDate, d.new_date);
      const nextEn = fmt(enDate, d.new_date);
      if (!nextRo || !nextEn) {
        return {
          ro: `Termenul de judecată din ${prevRo ?? "data anterioară"} nu mai apare în sursă și nu a fost afișat un termen nou. Verificați dosarul.`,
          en: `The hearing of ${prevEn ?? "the previous date"} no longer appears in the source and no new hearing is shown. Please review the case.`,
        };
      }
      return {
        ro: `Termenul de judecată a fost reprogramat. Termenul anterior era ${prevRo}, iar noul termen este ${nextRo}.`,
        en: `The court hearing has been rescheduled. The previous hearing date was ${prevEn}, and the new hearing date is ${nextEn}.`,
      };
    }
    case "hearing_postponed": {
      const prevRo = fmt(roDate, d.previous_date);
      const prevEn = fmt(enDate, d.previous_date);
      const nextRo = fmt(roDate, d.new_date);
      const nextEn = fmt(enDate, d.new_date);
      const sol = quote(d.solution_text);
      return {
        ro: `La termenul din ${prevRo} instanța a amânat cauza${sol ? ` („${sol}”)` : ""}.${nextRo ? ` Noul termen este ${nextRo}.` : " Noul termen nu este încă afișat."}`,
        en: `At the hearing of ${prevEn} the court postponed the case${sol ? ` ("${sol}")` : ""}.${nextEn ? ` The new hearing date is ${nextEn}.` : " The new hearing date is not shown yet."}`,
      };
    }
    case "hearing_scheduled": {
      const ro = fmt(roDate, d.hearing_date);
      const en = fmt(enDate, d.hearing_date);
      const time = d.hearing_time ? `, ora ${d.hearing_time}` : "";
      const timeEn = d.hearing_time ? ` at ${d.hearing_time}` : "";
      return {
        ro: `A fost stabilit un nou termen de judecată: ${ro}${time}${d.panel ? ` (complet ${d.panel})` : ""}.`,
        en: `A new court hearing has been scheduled for ${en}${timeEn}${d.panel ? ` (panel ${d.panel})` : ""}.`,
      };
    }
    case "decision_issued": {
      const ro = fmt(roDate, d.hearing_date);
      const en = fmt(enDate, d.hearing_date);
      const sol = quote(d.solution_text);
      const doc = quote(d.document_reference, 80);
      return {
        ro: `Instanța a pronunțat o soluție la termenul din ${ro}${doc ? ` (${doc})` : ""}.${sol ? ` Soluția pe scurt, conform sursei: „${sol}”.` : ""} Termenele procedurale care decurg din această soluție nu sunt calculate automat și trebuie stabilite de avocat.`,
        en: `The court issued a ruling at the hearing of ${en}${doc ? ` (${doc})` : ""}.${sol ? ` Summary of the ruling as published: "${sol}".` : ""} Any resulting procedural deadline is not calculated automatically and must be determined by a lawyer.`,
      };
    }
    case "status_changed":
      return {
        ro: `Starea dosarului s-a schimbat din „${quote(d.from, 100)}” în „${quote(d.to, 100)}”.`,
        en: `The case status changed from "${quote(enTerm(d.from), 140)}" to "${quote(enTerm(d.to), 140)}".`,
      };
    case "stage_changed":
      return {
        ro: `Stadiul procesual s-a schimbat din „${quote(d.from, 100)}” în „${quote(d.to, 100)}”.`,
        en: `The procedural stage changed from "${quote(enTerm(d.from), 140)}" to "${quote(enTerm(d.to), 140)}".`,
      };
  }
}

export class DeterministicSummaryProvider implements SummaryProvider {
  readonly id = "deterministic_template" as const;
  async summarize(event: DetectedEvent): Promise<EventSummary> {
    return { ...summarizeDeterministically(event), source: this.id };
  }
}
