import { displayCourtTerm } from "@/i18n/court-terms";
import { getLocale, getT } from "@/i18n/server";

/**
 * Court-published text (court name, stage, status, outcome). In English the
 * gloss is shown with the Romanian original next to it; in Romanian, or for
 * unknown terms, the original only.
 */
export async function CourtText({ value, kind = "term" }: { value: string | null | undefined; kind?: "term" | "court" }) {
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  const d = displayCourtTerm(value, locale, kind);
  if (!d) return <>—</>;
  if (!d.original) return <span lang="ro">{d.text}</span>;
  return (
    <span>
      {d.text}{" "}
      <span lang="ro" className="text-muted-foreground" title={t.courtTerms.originalHint}>
        ({d.original})
      </span>
    </span>
  );
}
