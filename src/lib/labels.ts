/** Romanian UI labels for database enums. */

export const ROLE_LABELS = { admin: "Administrator", lawyer: "Avocat", assistant: "Asistent" } as const;

export const MEMBER_STATUS_LABELS = { active: "Activ", suspended: "Suspendat", removed: "Eliminat" } as const;

export const CASE_STATUS_LABELS = { active: "Activ", closed: "Închis", archived: "Arhivat" } as const;

export const MATTER_TYPE_LABELS = {
  civil: "Civil",
  commercial: "Comercial",
  labor: "Litigii de muncă",
  administrative: "Contencios administrativ",
  family: "Familie",
  enforcement: "Executare silită",
  insolvency: "Insolvență",
  criminal: "Penal",
  other: "Altele",
} as const;

export const CHECK_OUTCOME_LABELS = {
  never_checked: "Neverificat",
  changes_detected: "Actualizare nouă detectată",
  no_changes: "Nicio modificare",
  failed: "Verificare eșuată",
  incomplete: "Date incomplete",
  source_unavailable: "Sursă indisponibilă",
} as const;

export const EVENT_TYPE_LABELS = {
  monitoring_started: "Monitorizare pornită",
  hearing_scheduled: "Termen nou",
  hearing_rescheduled: "Termen reprogramat",
  hearing_postponed: "Cauză amânată",
  decision_issued: "Soluție pronunțată",
  status_changed: "Stare modificată",
  stage_changed: "Stadiu procesual modificat",
} as const;

export const REMINDER_STATUS_LABELS = {
  proposed: "Propus",
  confirmed: "Confirmat de avocat",
  completed: "Finalizat",
  needs_review: "Necesită verificare",
} as const;

export const REMINDER_ORIGIN_LABELS = {
  manual: "Introdus manual",
  suggested: "Sugerat din sursă",
} as const;

export const ERROR_CODE_LABELS: Record<string, string> = {
  source_unavailable: "Sursa nu a răspuns.",
  provider_exception: "Eroare la interogarea sursei.",
  provider_timeout: "Sursa nu a răspuns în timp util.",
  provider_disabled: "Integrarea cu sursa nu este activată.",
  insecure_transport_refused: "Conexiune nesecurizată refuzată.",
  invalid_response: "Răspunsul sursei nu a putut fi validat.",
  missing_fields: "Răspunsul sursei nu conține toate datele necesare.",
  case_not_found_at_source: "Dosarul nu a fost găsit la sursă.",
  court_not_recognized: "Instanța nu a putut fi identificată în nomenclatorul portalului. Verificați denumirea instanței.",
  ambiguous_source_result: "Sursa a returnat mai multe dosare cu același număr; este necesară verificarea manuală.",
  source_http_error: "Sursa a răspuns cu o eroare neașteptată.",
};

export function label<T extends Record<string, string>>(map: T, key: string | null | undefined): string {
  if (!key) return "—";
  return (map as Record<string, string>)[key] ?? key;
}
