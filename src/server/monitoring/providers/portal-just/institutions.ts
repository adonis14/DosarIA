import { PORTAL_INSTITUTIONS, type PortalInstitution } from "./institutions.generated";

/**
 * Maps the free-text court name stored on a case (e.g. "Tribunalul București",
 * "Judecătoria Sectorului 1 București") to the portal's `Institutie` enum
 * value (e.g. "TribunalulBUCURESTI", "JudecatoriaSECTORUL1BUCURESTI").
 *
 * Matching is exact after normalization (diacritics removed, case and
 * punctuation ignored, "Sectorului" → "Sectorul"). Anything ambiguous or
 * unknown returns null: we never guess which court to query.
 */

function key(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (ă â î ș ț …)
    .toUpperCase()
    .replace(/SECTORULUI/g, "SECTORUL")
    .replace(/[^A-Z0-9]/g, "");
}

const BY_KEY = new Map<string, PortalInstitution>(PORTAL_INSTITUTIONS.map((v) => [key(v), v]));

export function resolvePortalInstitution(courtName: string): PortalInstitution | null {
  const trimmed = courtName.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return BY_KEY.get(key(trimmed)) ?? null;
}

export function isPortalInstitution(value: string): value is PortalInstitution {
  return (PORTAL_INSTITUTIONS as readonly string[]).includes(value);
}
