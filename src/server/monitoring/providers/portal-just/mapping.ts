import { classifySolution } from "@/server/monitoring/normalize";
import type { PortalDosar } from "./soap";

/**
 * Maps a portal `Dosar` to the provider-neutral raw shape consumed by
 * normalizeCourtCase() (see ../../normalize.ts). Decisions made here:
 *
 * 1. DATA MINIMIZATION — party names (`parti`) are NOT carried over. The
 *    product does not display them, they frequently identify natural persons,
 *    and change detection does not need them. Appeals (`caiAtac`) are not
 *    modelled yet either (roadmap).
 * 2. STATUS — the portal has no case-status field. A coarse status is DERIVED
 *    from the hearings and explicitly labelled "(dedus)" so it is never
 *    mistaken for an official value.
 * 3. LIMITS — free-text fields are truncated to the normalizer's limits so a
 *    long but legitimate court text does not turn a valid response into an
 *    "invalid" one.
 * 4. TIMES — portal dateTimes carry no offset and are Romanian local time;
 *    dataModificare is given the Europe/Bucharest offset for that instant.
 */

export const DERIVED_STATUS_PENDING = "În curs (dedus din ședințe)";
export const DERIVED_STATUS_DECIDED = "Soluționat (dedus din ședințe)";

const cut = (value: string | null, max: number): string | null => {
  if (!value) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const isoDay = (value: string | null): string | null => {
  const m = value?.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

/** "9:00" → "09:00"; anything else unparseable → null. */
export function normalizeHour(value: string | null): string | null {
  const m = value?.trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Bucharest", timeZoneName: "longOffset" });

/** "2026-11-20T14:05:00" (Romanian local time) → "2026-11-20T14:05:00+02:00". */
export function withBucharestOffset(value: string | null): string | null {
  const m = value?.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!m) return null;
  if (m[3]) return `${m[1]}${m[3] === "Z" ? "Z" : m[3]}`;
  const approx = new Date(`${m[1]}Z`);
  if (Number.isNaN(approx.getTime())) return null;
  const tz = offsetFormatter.formatToParts(approx).find((p) => p.type === "timeZoneName")?.value ?? "GMT+02:00";
  const offset = tz === "GMT" ? "+00:00" : tz.replace("GMT", "");
  return `${m[1]}${offset}`;
}

export function mapPortalDosarToRaw(dosar: PortalDosar) {
  const hearings = dosar.sedinte
    .map((s) => ({
      data: isoDay(s.data),
      ora: normalizeHour(s.ora),
      complet: cut(s.complet, 100),
      solutie: cut(s.solutie, 200),
      solutieSumar: cut(s.solutieSumar, 10_000), // observed live: up to ~5,200 chars
      numarDocument: cut(s.numarDocument, 200),
      documentSedinta: cut(s.documentSedinta, 200),
      dataDocument: isoDay(s.dataDocument),
    }))
    .filter((s): s is typeof s & { data: string } => s.data !== null)
    .sort((a, b) => (a.data + (a.ora ?? "")).localeCompare(b.data + (b.ora ?? "")))
    .slice(-500);

  const last = hearings[hearings.length - 1];
  const decided = last ? classifySolution(last.solutie) === "decision" : false;

  return {
    numar: cut(dosar.numar, 60) ?? "",
    institutie: cut(dosar.institutie, 200) ?? "",
    obiect: cut(dosar.obiect, 500),
    stadiuProcesual: cut(dosar.stadiuProcesualNume ?? dosar.stadiuProcesual, 100),
    categorieCaz: cut(dosar.categorieCazNume ?? dosar.categorieCaz, 100),
    stareDosar: decided ? DERIVED_STATUS_DECIDED : DERIVED_STATUS_PENDING,
    dataModificare: withBucharestOffset(dosar.dataModificare),
    parti: [], // intentionally not stored (data minimization)
    sedinte: hearings,
  };
}
