import type { Locale } from "./config";

/**
 * English glosses for Romanian terms published by the courts (procedural
 * stages, case statuses, hearing outcomes, subject matters) and for court
 * names.
 *
 * The court's original wording is the authoritative text. In English the UI
 * shows the gloss *next to* the original, e.g. "Ruling postponed (Amână
 * pronunțarea)", so a lawyer can always match it to the court record.
 * Unknown terms are shown unchanged, never guessed.
 *
 * Glosses are descriptive aids, not legal translations.
 */

/** Lower-case, strip diacritics (both comma-below ș/ț and cedilla ş/ţ) and collapse whitespace. */
export function normalizeTerm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.;:,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const TERMS: Record<string, string> = {
  // Procedural stages (stadiu procesual)
  fond: "First instance",
  apel: "Appeal",
  recurs: "Second appeal (on points of law)",
  "recurs in casatie": "Appeal in cassation",
  "contestatie in anulare": "Annulment challenge",
  revizuire: "Revision",
  "fond dupa casare cu trimitere": "Retrial after cassation",
  "apel dupa casare cu trimitere": "Appeal after cassation",
  "camera preliminara": "Preliminary chamber",
  "camera de consiliu": "Council chamber",
  "contestatie (ncpp)": "Challenge (Criminal Procedure Code)",
  contestatie: "Challenge",
  "executare": "Enforcement",
  "contestatie la executare": "Enforcement challenge",
  sesizare: "Referral",
  stramutare: "Transfer of venue",

  // Case statuses (as published or derived by DosarIA)
  "in curs de judecata": "Pending trial",
  "in curs": "Pending",
  solutionat: "Decided",
  "in curs (dedus din sedinte)": "Pending (derived from hearings)",
  "solutionat (dedus din sedinte)": "Decided (derived from hearings)",
  suspendat: "Suspended",
  "inchis": "Closed",

  // Hearing outcomes (solutie)
  amana: "Adjourned",
  "amana cauza": "Case adjourned",
  "amana pronuntarea": "Ruling postponed",
  "amanare pronuntare": "Ruling postponed",
  admite: "Granted",
  "admite in parte": "Partially granted",
  "admite in parte cererea": "Claim partially granted",
  "admite cererea": "Claim granted",
  respinge: "Dismissed",
  "respinge actiunea": "Action dismissed",
  "respinge cererea": "Claim dismissed",
  anuleaza: "Annulled",
  suspenda: "Suspended",
  "suspenda judecata": "Proceedings suspended",
  "termen preschimbat": "Hearing date changed",
  "alte solutii": "Other outcome",
  "declina competenta": "Jurisdiction declined",
  "declinare competenta": "Jurisdiction declined",
  "constata perimarea": "Proceedings lapsed (perimare)",
  perimare: "Lapse of proceedings (perimare)",
  "renuntare la judecata": "Claim withdrawn",
  "inchide dosarul": "Case closed",
  "incetare": "Proceedings discontinued",
  "dispune": "Orders",
  "repunere pe rol": "Case reinstated",
  "conexare": "Cases joined",
  "disjunge": "Cases severed",
  "solutionat - admis": "Decided — granted",
  "solutionat - respins": "Decided — dismissed",

  // Common subject matters (obiect)
  pretentii: "Monetary claims",
  "ordonanta de plata": "Payment order",
  "actiune in anulare": "Action for annulment",
  "obligatia de a face": "Obligation to act",
  "cerere de valoare redusa": "Small claim",
  "contestatie decizie de concediere": "Dismissal challenge",
  "divort": "Divorce",
  "insolventa": "Insolvency",
  "anulare act": "Annulment of a deed",
  "uzucapiune": "Acquisitive prescription",
  partaj: "Partition",
};

const CITIES: Record<string, string> = { bucuresti: "Bucharest" };

function city(name: string): string {
  return CITIES[normalizeTerm(name)] ?? name;
}

/** English gloss of a court name, built from the standard Romanian patterns; null if not recognized. */
export function courtNameGloss(name: string): string | null {
  const n = name.replace(/\s+/g, " ").trim();
  const norm = normalizeTerm(n);
  if (norm === "inalta curte de casatie si justitie") return "High Court of Cassation and Justice";
  if (norm === "curtea militara de apel bucuresti") return "Bucharest Military Court of Appeal";

  let m = /^judecatoria sector(?:ul|ului)? (\d) bucuresti$/.exec(norm);
  if (m) return `Bucharest Sector ${m[1]} District Court`;

  const patterns: [RegExp, (place: string) => string][] = [
    [/^Curtea de Apel (.+)$/iu, (p) => `${city(p)} Court of Appeal`],
    [/^Tribunalul Specializat (.+)$/iu, (p) => `${city(p)} Specialised Tribunal`],
    [/^Tribunalul Comercial (.+)$/iu, (p) => `${city(p)} Commercial Tribunal`],
    [/^Tribunalul pentru minori [şsș]i familie (.+)$/iu, (p) => `${city(p)} Juvenile and Family Tribunal`],
    [/^Tribunalul Militar Teritorial (.+)$/iu, (p) => `${city(p)} Territorial Military Tribunal`],
    [/^Tribunalul Militar (.+)$/iu, (p) => `${city(p)} Military Tribunal`],
    [/^Tribunalul (.+)$/iu, (p) => `${city(p)} Tribunal`],
    [/^Judec[ăa]toria (.+)$/iu, (p) => `${city(p)} District Court`],
  ];
  for (const [re, build] of patterns) {
    m = re.exec(n);
    if (m) return build(m[1]);
  }
  return null;
}

/** English gloss of a published court term (stage, status, outcome, subject); null if unknown. */
export function courtTermGloss(term: string): string | null {
  return TERMS[normalizeTerm(term)] ?? null;
}

export type CourtText = { text: string; original: string | null };

/**
 * What to display for court-published text in the given interface language:
 * in English, the gloss with the original kept alongside; in Romanian (or
 * for unknown terms), the original only.
 */
export function displayCourtTerm(term: string | null | undefined, locale: Locale, kind: "term" | "court" = "term"): CourtText | null {
  if (!term) return null;
  if (locale === "ro") return { text: term, original: null };
  const gloss = kind === "court" ? courtNameGloss(term) : courtTermGloss(term);
  return gloss ? { text: gloss, original: term } : { text: term, original: null };
}

/** Plain-text form, e.g. for summaries: "First instance (Fond)". */
export function courtTermInline(term: string | null | undefined, locale: Locale, kind: "term" | "court" = "term"): string | null {
  const d = displayCourtTerm(term, locale, kind);
  if (!d) return null;
  return d.original ? `${d.text} (${d.original})` : d.text;
}
