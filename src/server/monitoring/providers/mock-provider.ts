import { createHash } from "node:crypto";
import type { CourtCaseQuery, CourtDataProvider, ProviderResult, ProviderSourceMetadata } from "../types";

/**
 * MockCourtDataProvider — SYNTHETIC data only.
 *
 * Simulates how a court file evolves over successive checks. The state
 * returned depends only on (case number, attempt index, anchor date), so it
 * is deterministic and survives server restarts.
 *
 * Standard timeline (anchor A, default 2026-12-12, shifted 0–3 weeks per case):
 *   attempt 0  baseline: past hearing (postponed) + pending hearing on A
 *   attempt 1  no change
 *   attempt 2  hearing moved A → A+7          (hearing_rescheduled)
 *   attempt 3  source unavailable
 *   attempt 4  incomplete data (no hearings list)
 *   attempt 5  A+7 postponed, new hearing A+21 (hearing_postponed)
 *   attempt 6  decision at A+21, status "Soluționat" (decision_issued, status_changed)
 *   attempt 7  appeal: stage "Apel", new hearing A+90 (stage_changed, status_changed, hearing_scheduled)
 *   attempt 8+ no change
 *
 * Special case numbers (first segment) for exercising failure handling:
 *   9999/… always unavailable · 9998/… malformed payload · 9997/… always incomplete
 *   9996/… not found at source
 */

const PARTY_POOL = [
  "Alfa Construct SRL",
  "Beta Logistic SA",
  "Gamma Consult SRL",
  "Delta Agro SRL",
  "Omega Leasing IFN SA",
  "Sigma Distribuție SRL",
  "Kappa Imobiliare SRL",
  "Lambda Energy SA",
];
const SUBJECT_POOL = [
  "pretenții",
  "ordonanță de plată",
  "contestație la executare",
  "acțiune în anulare",
  "obligația de a face",
];

export type MockProviderOptions = {
  /** YYYY-MM-DD base date for the simulated hearings. */
  anchorDate?: string;
  now?: () => Date;
  /** Artificial latency, to make loading states visible in demos. */
  latencyMs?: number;
};

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function seedOf(caseNumber: string): number {
  return createHash("sha256").update(caseNumber).digest().readUInt32BE(0);
}

type RawHearing = {
  data: string;
  ora: string;
  complet: string;
  solutie?: string;
  solutieSumar?: string;
  numarDocument?: string;
};

export class MockCourtDataProvider implements CourtDataProvider {
  readonly id = "mock";
  private readonly anchorDate: string;
  private readonly now: () => Date;
  private readonly latencyMs: number;

  constructor(options: MockProviderOptions = {}) {
    this.anchorDate = options.anchorDate ?? "2026-12-12";
    this.now = options.now ?? (() => new Date());
    this.latencyMs = options.latencyMs ?? 0;
  }

  async fetchCase(query: CourtCaseQuery, signal?: AbortSignal): Promise<ProviderResult> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));

    const source: ProviderSourceMetadata = {
      provider: this.id,
      sourceReference: `mock://portal.just.ro/dosar/${encodeURIComponent(query.courtCaseNumber)}`,
      fetchedAt: this.now().toISOString(),
      transport: "mock",
    };
    if (signal?.aborted) return { kind: "error", source, errorCode: "provider_timeout" };

    const prefix = query.courtCaseNumber.split("/")[0];
    if (prefix === "9999") return { kind: "unavailable", source, reason: "Simulated: portal unreachable" };
    if (prefix === "9996") return { kind: "error", source, errorCode: "case_not_found_at_source" };
    if (prefix === "9998") {
      return { kind: "ok", source, payload: { numar: query.courtCaseNumber, institutie: 42, sedinte: "n/a" } };
    }

    const step = Math.max(0, Math.floor(query.attempt));
    if (prefix === "9997") {
      return { kind: "ok", source, payload: this.buildState(query, 0, { omitHearings: true }) };
    }
    if (step === 3) return { kind: "unavailable", source, reason: "Simulated: portal maintenance window" };
    if (step === 4) return { kind: "ok", source, payload: this.buildState(query, step, { omitHearings: true }) };
    return { kind: "ok", source, payload: this.buildState(query, step) };
  }

  /** Raw, portal-shaped payload for a given step of the standard timeline. */
  private buildState(query: CourtCaseQuery, step: number, opts: { omitHearings?: boolean } = {}) {
    const seed = seedOf(query.courtCaseNumber);
    const a = addDays(this.anchorDate, (seed % 4) * 7);
    const d = (n: number) => addDays(a, n);
    const panel = `C${(seed % 9) + 1}`;
    const time = ["09:00", "10:30", "12:00"][seed % 3];
    const claimant = seed % PARTY_POOL.length;
    // Always a different company from the claimant.
    const defendant = (claimant + 1 + ((seed >>> 8) % (PARTY_POOL.length - 1))) % PARTY_POOL.length;

    const first: RawHearing = {
      data: d(-30),
      ora: time,
      complet: panel,
      solutie: "Amână",
      solutieSumar: "Amână cauza pentru lipsă de procedură cu pârâta.",
    };

    let stage = "Fond";
    let status = "În curs de judecată";
    let hearings: RawHearing[];
    let version = 0;

    if (step <= 1) {
      hearings = [first, { data: d(0), ora: time, complet: panel }];
    } else if (step <= 4) {
      version = 1;
      hearings = [first, { data: d(7), ora: time, complet: panel }];
    } else if (step === 5) {
      version = 2;
      hearings = [
        first,
        { data: d(7), ora: time, complet: panel, solutie: "Amână pronunțarea", solutieSumar: "Amână pronunțarea." },
        { data: d(21), ora: "12:00", complet: panel },
      ];
    } else {
      version = step === 6 ? 3 : 4;
      hearings = [
        first,
        { data: d(7), ora: time, complet: panel, solutie: "Amână pronunțarea", solutieSumar: "Amână pronunțarea." },
        {
          data: d(21),
          ora: "12:00",
          complet: panel,
          solutie: "Admite",
          solutieSumar:
            "Admite în parte cererea de chemare în judecată. Cu drept de apel. Pronunțată prin punerea soluției la dispoziția părților prin mijlocirea grefei.",
          numarDocument: `Hotărâre ${100 + (seed % 800)}/${d(21).slice(0, 4)}`,
        },
      ];
      status = "Soluționat";
      if (step >= 7) {
        stage = "Apel";
        status = "În curs de judecată";
        hearings.push({ data: d(90), ora: "10:00", complet: `${panel} Apel` });
      }
    }

    return {
      numar: query.courtCaseNumber,
      institutie: query.courtName,
      obiect: SUBJECT_POOL[seed % SUBJECT_POOL.length],
      stadiuProcesual: stage,
      categorieCaz: "Civil",
      stareDosar: status,
      dataModificare: `${d(version * 7 - 30)}T08:00:00+02:00`,
      parti: [
        { nume: PARTY_POOL[claimant], calitateParte: "Reclamant" },
        { nume: PARTY_POOL[defendant], calitateParte: "Pârât" },
      ],
      ...(opts.omitHearings ? {} : { sedinte: hearings }),
    };
  }
}
