import { z } from "zod";

/**
 * Normalization of untrusted provider payloads.
 *
 * The raw shape mirrors the field names used by the public portal's SOAP
 * service (numar, institutie, obiect, stadiuProcesual, parti, sedinte, ...)
 * so that a future PortalJustSoapProvider can feed the same normalizer.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const shortText = (max: number) => z.string().trim().max(max);

const RawHearingSchema = z.object({
  data: isoDate,
  ora: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  complet: shortText(100).nullish(),
  solutie: shortText(200).nullish(),
  // Real portal summaries reach several thousand characters and the decisive
  // part (e.g. appeal rights) is usually at the END — never truncate to 1000.
  solutieSumar: shortText(10_000).nullish(),
  numarDocument: shortText(200).nullish(),
});

const RawPartySchema = z.object({
  nume: shortText(300),
  calitateParte: shortText(100).nullish(),
});

/** Lenient raw schema: fields may be missing (→ incomplete), but types must be right. */
export const RawCourtCaseSchema = z.object({
  numar: shortText(60),
  institutie: shortText(200),
  obiect: shortText(500).nullish(),
  stadiuProcesual: shortText(100).nullish(),
  categorieCaz: shortText(100).nullish(),
  stareDosar: shortText(200).nullish(),
  dataModificare: z.iso.datetime({ offset: true }).nullish(),
  parti: z.array(RawPartySchema).max(100).nullish(),
  sedinte: z.array(RawHearingSchema).max(500).nullish(),
});

export type SolutionType = "postponement" | "decision" | "other";

export type NormalizedHearing = {
  date: string;
  time: string | null;
  panel: string | null;
  solutionType: SolutionType | null;
  solutionText: string | null;
  documentReference: string | null;
};

export type NormalizedCase = {
  courtCaseNumber: string;
  courtName: string;
  subject: string | null;
  stage: string;
  status: string;
  category: string | null;
  parties: { name: string; role: string | null }[];
  hearings: NormalizedHearing[];
  lastModifiedAtSource: string | null;
};

export type NormalizeResult =
  | { kind: "complete"; data: NormalizedCase }
  | { kind: "incomplete"; data: Partial<NormalizedCase>; missingFields: string[] }
  | { kind: "invalid"; issues: string[] };

/** Romanian court solution wording → coarse type. Unknown wording → "other" (flagged for review). */
export function classifySolution(text: string | null | undefined): SolutionType | null {
  if (!text || !text.trim()) return null;
  const t = text.trim().toLocaleLowerCase("ro-RO");
  if (/^amân|^aman|amânare|amanare/.test(t)) return "postponement";
  if (/(admite|respinge|anuleaz|constat|hotăr|hotar|soluționat|solutionat|închide|inchide|încuviinț|incuviint|dispune|obligă|obliga)/.test(t)) {
    return "decision";
  }
  return "other";
}

function nullIfEmpty(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeCourtCase(payload: unknown): NormalizeResult {
  const parsed = RawCourtCaseSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      kind: "invalid",
      issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`),
    };
  }
  const raw = parsed.data;

  const hearings: NormalizedHearing[] | null = raw.sedinte
    ? raw.sedinte
        .map((h) => ({
          date: h.data,
          time: h.ora ?? null,
          panel: nullIfEmpty(h.complet),
          solutionType: classifySolution(h.solutie),
          solutionText: nullIfEmpty(h.solutieSumar) ?? nullIfEmpty(h.solutie),
          documentReference: nullIfEmpty(h.numarDocument),
        }))
        .sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")))
    : null;

  const base = {
    courtCaseNumber: raw.numar.trim(),
    courtName: raw.institutie.trim(),
    subject: nullIfEmpty(raw.obiect),
    category: nullIfEmpty(raw.categorieCaz),
    parties: (raw.parti ?? []).map((p) => ({ name: p.nume.trim(), role: nullIfEmpty(p.calitateParte) })),
    lastModifiedAtSource: raw.dataModificare ?? null,
  };

  const stage = nullIfEmpty(raw.stadiuProcesual);
  const status = nullIfEmpty(raw.stareDosar);
  const missingFields: string[] = [];
  if (hearings === null) missingFields.push("sedinte");
  if (stage === null) missingFields.push("stadiuProcesual");
  if (status === null) missingFields.push("stareDosar");

  if (missingFields.length > 0) {
    return {
      kind: "incomplete",
      missingFields,
      data: { ...base, ...(stage ? { stage } : {}), ...(status ? { status } : {}), ...(hearings ? { hearings } : {}) },
    };
  }

  return { kind: "complete", data: { ...base, stage: stage!, status: status!, hearings: hearings! } };
}
