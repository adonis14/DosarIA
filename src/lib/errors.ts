/**
 * Sanitized errors. Users see a short, generic Romanian message; server logs
 * get an error code and context label only — never request payloads,
 * credentials, tokens or case contents.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code: AppErrorCode; fieldErrors?: Record<string, string[]> };

export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "provider_failed"
  | "internal";

export const MESSAGES: Record<AppErrorCode, string> = {
  unauthenticated: "Sesiunea a expirat. Autentificați-vă din nou.",
  forbidden: "Nu aveți permisiunea de a efectua această operațiune.",
  not_found: "Resursa nu a fost găsită sau nu aveți acces la ea.",
  validation: "Datele introduse nu sunt valide.",
  conflict: "Operațiunea intră în conflict cu datele existente.",
  rate_limited: "Prea multe încercări. Așteptați puțin și încercați din nou.",
  provider_failed: "Verificarea sursei a eșuat.",
  internal: "A apărut o eroare neașteptată. Încercați din nou.",
};

export function fail(code: AppErrorCode, error?: string, fieldErrors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, code, error: error ?? MESSAGES[code], ...(fieldErrors ? { fieldErrors } : {}) };
}

type PgLikeError = { code?: string | null; message?: string | null } | null | undefined;

/** Map a PostgREST/PostgreSQL error to a safe application error code. */
export function classifyDbError(error: PgLikeError): AppErrorCode {
  switch (error?.code) {
    case "42501": // insufficient_privilege (RLS / grants / guard triggers)
      return "forbidden";
    case "23505": // unique_violation
      return "conflict";
    case "23503": // foreign_key_violation (e.g. cross-organization reference)
    case "23514": // check_violation
    case "22023": // invalid_parameter_value
    case "22P02": // invalid_text_representation
      return "validation";
    case "P0002":
    case "PGRST116":
      return "not_found";
    default:
      return "internal";
  }
}

/** Log without leaking payloads: context label + error code only. */
export function logServerError(context: string, error: PgLikeError | unknown) {
  const code = (error as { code?: string } | null)?.code ?? "unknown";
  console.error(`[dosaria] ${context} failed (code=${code})`);
}
