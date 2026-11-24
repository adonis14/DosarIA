import type { CourtCaseQuery, CourtDataProvider, ProviderResult, ProviderSourceMetadata } from "../types";

/**
 * PortalJustSoapProvider — INTERFACE ONLY. NOT ACTIVE IN THIS MVP.
 *
 * The courts portal documents a public SOAP query service at
 * portalquery.just.ro/query.asmx (operations such as `CautareDosare` and
 * `CautareSedinte`). Before this provider may be implemented and enabled,
 * Agora Origin must separately verify and document:
 *   1. that the endpoint is reachable and served over HTTPS with a valid
 *      certificate (this class refuses any non-https endpoint);
 *   2. the portal's terms of use for automated queries and an acceptable
 *      polling frequency (no scraping, no aggressive polling);
 *   3. data completeness and reliability against a set of real files;
 *   4. what is stored, for how long, and under which legal basis.
 *
 * Until then `fetchCase` never performs network I/O and reports
 * `provider_disabled`, which the monitoring service records as a FAILED
 * check — never as "no changes".
 */

export type PortalJustSoapConfig = {
  endpoint: string;
  /** Must only be set after the approval described above. */
  integrationApproved: boolean;
  /** Minimum minutes between checks of the same file, per the approved terms. */
  minPollingIntervalMinutes: number;
  timeoutMs: number;
};

export class PortalJustSoapProvider implements CourtDataProvider {
  readonly id = "portaljust_soap";
  private readonly config: PortalJustSoapConfig;

  constructor(config: PortalJustSoapConfig) {
    this.config = config;
  }

  /** True only for an https:// URL; plain HTTP is refused (no confidential data over unencrypted transport). */
  static isSecureEndpoint(endpoint: string): boolean {
    try {
      return new URL(endpoint).protocol === "https:";
    } catch {
      return false;
    }
  }

  async fetchCase(query: CourtCaseQuery): Promise<ProviderResult> {
    const source: ProviderSourceMetadata = {
      provider: this.id,
      sourceReference: null,
      fetchedAt: new Date().toISOString(),
      transport: "https",
    };
    void query;

    if (!PortalJustSoapProvider.isSecureEndpoint(this.config.endpoint)) {
      return { kind: "error", source, errorCode: "insecure_transport_refused" };
    }
    if (!this.config.integrationApproved) {
      return { kind: "error", source, errorCode: "provider_disabled" };
    }
    // Deliberately unimplemented: enabling the flag alone must not start
    // live traffic. Implementation requires the review listed above.
    return { kind: "error", source, errorCode: "provider_disabled" };
  }
}
