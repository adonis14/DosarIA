import type { CourtCaseQuery, CourtDataProvider, ProviderResult, ProviderSourceMetadata } from "../types";
import { resolvePortalInstitution } from "./portal-just/institutions";
import { mapPortalDosarToRaw } from "./portal-just/mapping";
import {
  buildSoapEnvelope,
  MAX_RESPONSE_BYTES,
  parseCautareDosareResponse,
  PortalSoapError,
  soapActionFor,
} from "./portal-just/soap";

/**
 * PortalJustSoapProvider — real client for the public SOAP service of the
 * Romanian courts portal (portalquery.just.ro, operation `CautareDosare`).
 *
 * DISABLED BY DEFAULT. It performs network I/O only when ALL hold:
 *   - COURT_DATA_PROVIDER=portaljust_soap
 *   - PORTAL_JUST_INTEGRATION_APPROVED=true (set only after the review in
 *     docs/PORTAL-INTEGRATION.md: terms of use, polling limits, legal basis)
 *   - the endpoint is https:// (plain HTTP is always refused: the set of case
 *     numbers a firm monitors is confidential client information).
 *
 * As verified on 2026-11-25, the HTTPS endpoint returns Cloudflare error 525
 * (TLS handshake to the origin fails), so even when enabled every check is
 * recorded as "source unavailable" — never as "no changes".
 *
 * Traffic discipline (no live polling exists; checks are manual):
 *   - one request in flight at a time, with a minimum gap between requests;
 *   - `minIntervalMs` per file, enforced by the monitoring service before any
 *     request (a too-early check is refused, not answered from a cache, so
 *     freshness is never overstated);
 *   - redirects are refused (no silent downgrade to HTTP);
 *   - responses larger than 5 MB are rejected.
 */

export type PortalJustSoapConfig = {
  endpoint: string;
  /** Must only be set after the approval described in docs/PORTAL-INTEGRATION.md. */
  integrationApproved: boolean;
  /** Minimum minutes between two portal requests for the same file (served from cache meanwhile). */
  minPollingIntervalMinutes: number;
  timeoutMs: number;
  /** Minimum milliseconds between any two portal requests (global, per process). */
  minRequestGapMs?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export class PortalJustSoapProvider implements CourtDataProvider {
  readonly id = "portaljust_soap";
  /** Enforced by the monitoring service BEFORE any request (nothing is recorded when too soon). */
  readonly minIntervalMs: number;
  private readonly config: PortalJustSoapConfig;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(config: PortalJustSoapConfig) {
    this.config = config;
    this.minIntervalMs = Math.max(0, config.minPollingIntervalMinutes) * 60_000;
  }

  /** True only for an https:// URL; plain HTTP is refused. */
  static isSecureEndpoint(endpoint: string): boolean {
    try {
      return new URL(endpoint).protocol === "https:";
    } catch {
      return false;
    }
  }

  private now() {
    return (this.config.now ?? (() => new Date()))();
  }

  private source(sourceReference: string | null): ProviderSourceMetadata {
    return { provider: this.id, sourceReference, fetchedAt: this.now().toISOString(), transport: "https" };
  }

  async fetchCase(query: CourtCaseQuery, signal?: AbortSignal): Promise<ProviderResult> {
    if (!PortalJustSoapProvider.isSecureEndpoint(this.config.endpoint)) {
      return { kind: "error", source: this.source(null), errorCode: "insecure_transport_refused" };
    }
    if (!this.config.integrationApproved) {
      return { kind: "error", source: this.source(null), errorCode: "provider_disabled" };
    }

    const institution = resolvePortalInstitution(query.courtName);
    if (!institution) {
      return { kind: "error", source: this.source(null), errorCode: "court_not_recognized" };
    }
    const reference = `portalquery.just.ro CautareDosare ${institution} ${query.courtCaseNumber}`;
    return this.enqueue(() => this.request(query.courtCaseNumber, institution, reference, signal));
  }

  /** Serialize requests and keep a minimum gap between them. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      const gap = this.config.minRequestGapMs ?? 1_000;
      const wait = this.lastRequestAt + gap - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await task();
      } finally {
        this.lastRequestAt = Date.now();
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async request(caseNumber: string, institution: string, reference: string, signal?: AbortSignal): Promise<ProviderResult> {
    const envelope = buildSoapEnvelope("CautareDosare", [
      ["numarDosar", caseNumber],
      ["obiectDosar", undefined],
      ["numeParte", undefined],
      ["institutie", institution],
      ["dataStart", null],
      ["dataStop", null],
    ]);

    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const doFetch = this.config.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: soapActionFor("CautareDosare"),
          "User-Agent": this.config.userAgent ?? "DosarIA/0.1 (Agora Origin; court-portal integration pilot)",
        },
        body: envelope,
        redirect: "error",
        signal: combined,
        cache: "no-store",
      });
    } catch (err) {
      const aborted = (err as { name?: string })?.name === "TimeoutError" || (err as { name?: string })?.name === "AbortError";
      return aborted
        ? { kind: "error", source: this.source(reference), errorCode: "provider_timeout" }
        : { kind: "unavailable", source: this.source(reference), reason: "network error" };
    }

    if (response.status === 429) {
      return { kind: "unavailable", source: this.source(reference), reason: "rate limited by source (HTTP 429)" };
    }
    if (response.status >= 500) {
      // Includes Cloudflare 520–530 (e.g. 525: TLS handshake to origin failed).
      return { kind: "unavailable", source: this.source(reference), reason: `source HTTP ${response.status}` };
    }
    if (response.status !== 200) {
      return { kind: "error", source: this.source(reference), errorCode: "source_http_error" };
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_RESPONSE_BYTES) {
      return { kind: "error", source: this.source(reference), errorCode: "invalid_response" };
    }
    const xml = await response.text();

    let dosare;
    try {
      dosare = parseCautareDosareResponse(xml);
    } catch (err) {
      if (err instanceof PortalSoapError) {
        return { kind: "error", source: this.source(reference), errorCode: "invalid_response" };
      }
      throw err;
    }

    const matches = dosare.filter((d) => d.numar === caseNumber && d.institutie === institution);
    if (matches.length === 0) {
      return { kind: "error", source: this.source(reference), errorCode: "case_not_found_at_source" };
    }
    if (matches.length > 1) {
      return { kind: "error", source: this.source(reference), errorCode: "ambiguous_source_result" };
    }
    return { kind: "ok", source: this.source(reference), payload: mapPortalDosarToRaw(matches[0]) };
  }
}
