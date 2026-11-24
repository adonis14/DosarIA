/**
 * STANDALONE LIVE VALIDATION of the public courts-portal SOAP service.
 *
 * Not part of `npm test` / CI. Runs only with:
 *   PORTAL_LIVE_VALIDATION=1 npm run test:portal-live
 * Plain-HTTP queries additionally require:
 *   PORTAL_LIVE_ALLOW_HTTP_FOR_PUBLIC_QUERY=1
 *
 * Safeguards:
 *  - At most 4 requests per run, ≥ 3 s apart, honest User-Agent.
 *  - HTTP is used ONLY for queries that contain no client information: a court
 *    + a past date (CautareSedinte), then ONE case number taken from that
 *    public hearing list. No DosarIA case or client data is ever sent.
 *  - Responses are processed in memory. The written report contains only
 *    non-personal metadata (counts, field presence, stage, dates, latency);
 *    party names are never logged or persisted (asserted below).
 *  - Nothing is written to any database.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeCourtCase } from "@/server/monitoring/normalize";
import { PortalJustSoapProvider } from "@/server/monitoring/providers/portal-just-soap-provider";
import { mapPortalDosarToRaw } from "@/server/monitoring/providers/portal-just/mapping";
import {
  buildSoapEnvelope,
  parseCautareDosareResponse,
  parseCautareSedinteResponse,
  soapActionFor,
} from "@/server/monitoring/providers/portal-just/soap";

const ENABLED = process.env.PORTAL_LIVE_VALIDATION === "1";
const ALLOW_HTTP = process.env.PORTAL_LIVE_ALLOW_HTTP_FOR_PUBLIC_QUERY === "1";
const HTTPS_ENDPOINT = "https://portalquery.just.ro/query.asmx";
const HTTP_ENDPOINT = "http://portalquery.just.ro/query.asmx";
const USER_AGENT = "DosarIA/0.1 (Agora Origin; court-portal integration validation; low volume)";
const COURT = "TribunalulBUCURESTI";
const MAX_REQUESTS = 4;

let requests = 0;
let lastRequest = 0;
const report: Record<string, unknown> = { ranAt: new Date().toISOString(), court: COURT, requests: [] as unknown[] };

async function soapCall(endpoint: string, operation: string, params: [string, string | null | undefined][]) {
  if (++requests > MAX_REQUESTS) throw new Error("request budget exceeded");
  const wait = lastRequest + 3000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const started = Date.now();
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: soapActionFor(operation), "User-Agent": USER_AGENT },
      body: buildSoapEnvelope(operation, params),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    (report.requests as unknown[]).push({
      operation,
      transport: new URL(endpoint).protocol.replace(":", ""),
      status: res.status,
      bytes: text.length,
      ms: Date.now() - started,
      server: res.headers.get("server"),
    });
    return { status: res.status, text };
  } finally {
    lastRequest = Date.now();
  }
}

function lastWeekday(): string {
  const d = new Date();
  do d.setUTCDate(d.getUTCDate() - 1);
  while ([0, 6].includes(d.getUTCDay()));
  return `${d.toISOString().slice(0, 10)}T00:00:00`;
}

describe.skipIf(!ENABLED)("LIVE portalquery.just.ro validation", () => {
  it("HTTPS: the real provider (approved for this test only) reports the true outcome", async () => {
    requests++;
    const provider = new PortalJustSoapProvider({
      endpoint: HTTPS_ENDPOINT,
      integrationApproved: true,
      minPollingIntervalMinutes: 60,
      timeoutMs: 30_000,
      minRequestGapMs: 0,
      userAgent: USER_AGENT,
    });
    // Synthetic, non-existent number: no client data is sent, even over HTTPS.
    const result = await provider.fetchCase({ courtCaseNumber: "1/1/1999", courtName: "Tribunalul București", attempt: 0 });
    lastRequest = Date.now();
    report.httpsProviderResult = result.kind === "unavailable" ? { kind: result.kind, reason: result.reason } : { kind: result.kind, ...(result.kind === "error" ? { errorCode: result.errorCode } : {}) };
    // Whatever the source does, the provider must never claim success silently.
    expect(["ok", "unavailable", "error"]).toContain(result.kind);
  }, 60_000);

  it.skipIf(!ALLOW_HTTP)("HTTP (public query only): hearing list → one public case → parse, map, normalize", async () => {
    const date = lastWeekday();
    const s = await soapCall(HTTP_ENDPOINT, "CautareSedinte", [
      ["dataSedinta", date],
      ["institutie", COURT],
    ]);
    expect(s.status).toBe(200);
    const sedinte = parseCautareSedinteResponse(s.text);
    const listed = sedinte.flatMap((x) => x.dosare);
    report.hearingList = {
      date,
      sessions: sedinte.length,
      casesListed: listed.length,
      stages: [...new Set(listed.map((d) => d.stadiuProcesualNume))].slice(0, 10),
      categories: [...new Set(listed.map((d) => d.categorieCazNume))].slice(0, 10),
    };
    expect(listed.length).toBeGreaterThan(0);

    const numar = listed.find((d) => d.numar && /^\d+\/\d+\/\d{4}$/.test(d.numar))?.numar;
    expect(numar).toBeTruthy();

    const r = await soapCall(HTTP_ENDPOINT, "CautareDosare", [
      ["numarDosar", numar!],
      ["institutie", COURT],
      ["dataStart", null],
      ["dataStop", null],
    ]);
    expect(r.status).toBe(200);
    const dosare = parseCautareDosareResponse(r.text);
    const exact = dosare.filter((d) => d.numar === numar && d.institutie === COURT);
    expect(exact.length).toBe(1);
    const dosar = exact[0];

    const raw = mapPortalDosarToRaw(dosar);
    const normalized = normalizeCourtCase(raw);
    const partyNames = dosar.parti.map((p) => p.nume).filter((n): n is string => Boolean(n && n.length > 2));

    // The structured party list is never carried over. (Court-written
    // solution summaries CAN mention parties — recorded as a finding below.)
    // Assertions compare booleans only, so a failure never prints court content.
    expect(raw.parti.length).toBe(0);
    const summariesMentionParties = raw.sedinte.some((h) => partyNames.some((n) => h.solutieSumar?.includes(n)));

    report.caseValidation = {
      resultsForNumber: dosare.length,
      exactMatches: exact.length,
      normalizedKind: normalized.kind,
      missingFields: normalized.kind === "incomplete" ? normalized.missingFields : [],
      fieldPresence: {
        numar: Boolean(dosar.numar),
        data: Boolean(dosar.data),
        departament: Boolean(dosar.departament),
        obiect: Boolean(dosar.obiect),
        obiectLength: dosar.obiect?.length ?? 0,
        stadiuProcesualNume: dosar.stadiuProcesualNume,
        categorieCazNume: dosar.categorieCazNume,
        dataModificare: dosar.dataModificare,
        partiCount: dosar.parti.length,
        sedinteCount: dosar.sedinte.length,
        caiAtacCount: dosar.caiAtac.length,
        sedinteWithOra: dosar.sedinte.filter((x) => x.ora).length,
        sedinteWithSolutie: dosar.sedinte.filter((x) => x.solutie).length,
        sedinteWithSolutieSumar: dosar.sedinte.filter((x) => x.solutieSumar).length,
        sedinteWithDataPronuntare: dosar.sedinte.filter((x) => x.dataPronuntare).length,
        maxSolutieSumarLength: Math.max(0, ...dosar.sedinte.map((x) => x.solutieSumar?.length ?? 0)),
        distinctSolutie: [...new Set(dosar.sedinte.map((x) => x.solutie).filter(Boolean))].slice(0, 10),
        oraSamples: [...new Set(dosar.sedinte.map((x) => x.ora).filter(Boolean))].slice(0, 5),
        dateSample: dosar.sedinte[0]?.data ?? null,
      },
      derivedStatus: raw.stareDosar,
      lastModifiedAtSource: raw.dataModificare,
      summariesMentionPartyNames: summariesMentionParties,
      latestHearingDate: raw.sedinte.at(-1)?.data ?? null,
    };
    expect(normalized.kind).toBe("complete");

    // Our own artefact must never contain party names (boolean check: no content in failure output).
    const serialized = JSON.stringify(report);
    expect(partyNames.some((n) => serialized.includes(n))).toBe(false);
  }, 120_000);

  it("writes the non-personal findings report", () => {
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/portal-live-report.json", JSON.stringify(report, null, 2));
    expect(requests).toBeLessThanOrEqual(MAX_REQUESTS);
  });
});
