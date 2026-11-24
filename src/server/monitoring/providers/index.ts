import "server-only";
import { serverEnv } from "@/lib/env";
import type { CourtDataProvider } from "../types";
import { MockCourtDataProvider } from "./mock-provider";
import { PortalJustSoapProvider } from "./portal-just-soap-provider";

let cached: CourtDataProvider | null = null;

export function getCourtDataProvider(): CourtDataProvider {
  if (cached) return cached;
  const env = serverEnv();
  if (env.COURT_DATA_PROVIDER === "portaljust_soap") {
    // Real provider: inert unless PORTAL_JUST_INTEGRATION_APPROVED=true AND the
    // endpoint is https:// (see docs/PORTAL-INTEGRATION.md).
    cached = new PortalJustSoapProvider({
      endpoint: env.PORTAL_JUST_SOAP_ENDPOINT,
      integrationApproved: env.PORTAL_JUST_INTEGRATION_APPROVED,
      minPollingIntervalMinutes: env.PORTAL_JUST_MIN_INTERVAL_MINUTES,
      timeoutMs: env.PORTAL_JUST_TIMEOUT_MS,
      minRequestGapMs: 2_000,
    });
  } else {
    cached = new MockCourtDataProvider({
      anchorDate: env.MOCK_COURT_ANCHOR_DATE,
      latencyMs: env.MOCK_COURT_LATENCY_MS,
    });
  }
  return cached;
}
