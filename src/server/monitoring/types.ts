/**
 * Court data provider abstraction.
 *
 * A provider fetches the *raw* public record of a court file from some source
 * (mock fixtures today; portalquery.just.ro later, once approved). Everything
 * a provider returns is UNTRUSTED: it is validated and normalized by
 * `normalize.ts` before it is compared, stored or summarized.
 */

export type CourtCaseQuery = {
  courtCaseNumber: string;
  courtName: string;
  /**
   * Number of previous check attempts for this case. Real providers ignore
   * it; the mock provider uses it to simulate the passage of time
   * deterministically (so demos and tests are reproducible across restarts).
   */
  attempt: number;
};

export type ProviderSourceMetadata = {
  /** Stable provider id, stored with snapshots, e.g. "mock" or "portaljust_soap". */
  provider: string;
  /** Human-readable reference to where the data came from (no secrets). */
  sourceReference: string | null;
  /** ISO timestamp at which the data was retrieved. */
  fetchedAt: string;
  /** Transport used. Real providers MUST use "https". */
  transport: "mock" | "https";
};

export type ProviderResult =
  | { kind: "ok"; source: ProviderSourceMetadata; payload: unknown }
  | { kind: "unavailable"; source: ProviderSourceMetadata; reason: string }
  | { kind: "error"; source: ProviderSourceMetadata; errorCode: ProviderErrorCode };

export type ProviderErrorCode =
  | "case_not_found_at_source"
  | "provider_timeout"
  | "provider_exception"
  | "provider_disabled"
  | "insecure_transport_refused"
  | "court_not_recognized"
  | "ambiguous_source_result"
  | "source_http_error"
  | "invalid_response";

export interface CourtDataProvider {
  /** Stable id, matches ^[a-z0-9_-]{1,40}$ (DB constraint). */
  readonly id: string;
  /**
   * Optional minimum interval between two checks of the same file. Enforced by
   * the monitoring service before calling the provider; a too-early check is
   * refused without recording a run (freshness is never overstated).
   */
  readonly minIntervalMs?: number;
  fetchCase(query: CourtCaseQuery, signal?: AbortSignal): Promise<ProviderResult>;
}
