import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { normalizeCourtCase } from "@/server/monitoring/normalize";
import { PortalJustSoapProvider, type PortalJustSoapConfig } from "@/server/monitoring/providers/portal-just-soap-provider";
import { resolvePortalInstitution } from "@/server/monitoring/providers/portal-just/institutions";
import { PORTAL_INSTITUTIONS } from "@/server/monitoring/providers/portal-just/institutions.generated";
import {
  DERIVED_STATUS_DECIDED,
  DERIVED_STATUS_PENDING,
  mapPortalDosarToRaw,
  normalizeHour,
  withBucharestOffset,
} from "@/server/monitoring/providers/portal-just/mapping";
import {
  buildSoapEnvelope,
  parseCautareDosareResponse,
  parseCautareSedinteResponse,
  parseXml,
  PortalSoapError,
} from "@/server/monitoring/providers/portal-just/soap";

const FIXTURE = readFileSync("tests/fixtures/portal-just/cautare-dosare.synthetic.xml", "utf8");
const query = { courtCaseNumber: "1234/3/2026", courtName: "Tribunalul București", attempt: 0 };

describe("strict XML parser", () => {
  it("rejects DTDs and entity declarations (XXE / billion laughs)", () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>')).toThrow(PortalSoapError);
    expect(() => parseXml('<x><!ENTITY a SYSTEM "file:///etc/passwd"></x>')).toThrow(PortalSoapError);
  });

  it("rejects unknown entities, bare ampersands, mismatched and unclosed tags", () => {
    expect(() => parseXml("<x>&nbsp;</x>")).toThrow(/unknown entity/);
    expect(() => parseXml("<x>a & b</x>")).toThrow(PortalSoapError);
    expect(() => parseXml("<a><b></a></b>")).toThrow(/mismatched/);
    expect(() => parseXml("<a><b></b>")).toThrow(/unclosed/);
    expect(() => parseXml("<a>1 < 2</a>")).toThrow(/unexpected markup/);
  });

  it("rejects oversized documents", () => {
    expect(() => parseXml(`<x>${"a".repeat(5 * 1024 * 1024 + 1)}</x>`)).toThrow(/too large/);
  });

  it("decodes predefined/numeric entities and CDATA, and records xsi:nil", () => {
    const doc = parseXml('<?xml version="1.0"?><r><a>&lt;&amp;&#x219;&#539;</a><b><![CDATA[<raw>]]></b><c xsi:nil="true" /></r>');
    const r = doc.children[0];
    expect(r.children[0].text).toBe("<&șț");
    expect(r.children[1].text).toBe("<raw>");
    expect(r.children[2].nil).toBe(true);
  });
});

describe("SOAP envelope", () => {
  it("escapes values (no XML injection through a case number or name)", () => {
    const env = buildSoapEnvelope("CautareDosare", [["numarDosar", '1/1/2026</numarDosar><numeParte>x</numeParte>']]);
    expect(env).toContain("1/1/2026&lt;/numarDosar&gt;&lt;numeParte&gt;x&lt;/numeParte&gt;");
    expect(env.match(/<numarDosar>/g)).toHaveLength(1);
    expect(env).not.toContain("<numeParte>");
  });

  it("sends nillable-required params as xsi:nil and omits optional ones", () => {
    const env = buildSoapEnvelope("CautareDosare", [
      ["numarDosar", "1234/3/2026"],
      ["obiectDosar", undefined],
      ["institutie", "TribunalulBUCURESTI"],
      ["dataStart", null],
    ]);
    expect(env).toContain('<dataStart xsi:nil="true" />');
    expect(env).not.toContain("obiectDosar");
    expect(env).toContain('<CautareDosare xmlns="portalquery.just.ro">');
    expect(() => parseXml(env)).not.toThrow();
  });

  it("rejects unsafe operation/parameter names", () => {
    expect(() => buildSoapEnvelope("Op><x", [])).toThrow();
    expect(() => buildSoapEnvelope("Op", [["a b", "x"]])).toThrow();
  });
});

describe("response parsing (synthetic fixture shaped like the official sample)", () => {
  it("parses Dosar records, skipping nil entries", () => {
    const dosare = parseCautareDosareResponse(FIXTURE);
    expect(dosare).toHaveLength(2);
    expect(dosare[0]).toMatchObject({ numar: "1234/3/2026", institutie: "TribunalulBUCURESTI", stadiuProcesualNume: "Fond" });
    expect(dosare[0].parti).toHaveLength(2);
    expect(dosare[0].sedinte).toHaveLength(2);
    expect(dosare[0].obiect).toBe("pretenţii <fictiv>");
    expect(dosare[0].sedinte[1].solutieSumar).toContain("pârâta & acordă");
  });

  it("returns [] for an empty or nil result", () => {
    const empty = FIXTURE.replace(/<CautareDosareResult>[\s\S]*<\/CautareDosareResult>/, '<CautareDosareResult xsi:nil="true" />');
    expect(parseCautareDosareResponse(empty)).toEqual([]);
  });

  it("turns SOAP faults into a typed error without echoing server internals", () => {
    const fault =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>System.NullReferenceException at C:\\inetpub\\...</faultstring></soap:Fault></soap:Body></soap:Envelope>';
    try {
      parseCautareDosareResponse(fault);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PortalSoapError);
      expect((e as PortalSoapError).kind).toBe("soap_fault");
      expect((e as Error).message).not.toContain("inetpub");
    }
  });

  it("parses CautareSedinte (hearing list, no party names)", () => {
    const xml =
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><CautareSedinteResponse xmlns="portalquery.just.ro"><CautareSedinteResult><Sedinta><departament>Secţia civilă</departament><complet>C1</complet><data>2026-11-24T00:00:00</data><ora>09:00</ora><dosare><SedintaDosar><numar>1/3/2026</numar><data>2026-11-24T00:00:00</data><ora>09:00</ora><categorieCazNume>Civil</categorieCazNume><stadiuProcesualNume>Fond</stadiuProcesualNume></SedintaDosar></dosare></Sedinta></CautareSedinteResult></CautareSedinteResponse></soap:Body></soap:Envelope>';
    const s = parseCautareSedinteResponse(xml);
    expect(s[0].dosare[0]).toEqual({ numar: "1/3/2026", data: "2026-11-24T00:00:00", ora: "09:00", categorieCazNume: "Civil", stadiuProcesualNume: "Fond" });
  });
});

describe("mapping portal Dosar → provider-neutral raw shape", () => {
  const [dosar] = parseCautareDosareResponse(FIXTURE);

  it("produces a COMPLETE normalized case", () => {
    const n = normalizeCourtCase(mapPortalDosarToRaw(dosar));
    expect(n.kind).toBe("complete");
    if (n.kind === "complete") {
      expect(n.data.hearings.map((h) => [h.date, h.time, h.solutionType])).toEqual([
        ["2026-11-12", "09:00", "postponement"],
        ["2026-12-19", "09:00", null],
      ]);
      // Document type and date tell a hearing record from a final ruling.
      expect(n.data.hearings.map((h) => [h.documentType, h.documentDate])).toEqual([
        ["Incheiereamanare", "2026-11-12"],
        [null, null],
      ]);
      expect(n.data.stage).toBe("Fond");
      expect(n.data.status).toBe(DERIVED_STATUS_PENDING);
      expect(n.data.lastModifiedAtSource).toBe("2026-07-15T10:30:00+03:00");
    }
  });

  it("never carries party names (data minimization)", () => {
    const raw = mapPortalDosarToRaw(dosar);
    expect(raw.parti).toEqual([]);
    expect(JSON.stringify(raw)).not.toContain("POPESCU");
    expect(JSON.stringify(raw)).not.toContain("ALFA CONSTRUCT");
  });

  it("derives a labelled status from the latest hearing", () => {
    const decided = { ...dosar, sedinte: [...dosar.sedinte, { ...dosar.sedinte[1], data: "2027-01-10T00:00:00", solutie: "Admite cererea" }] };
    expect(mapPortalDosarToRaw(decided).stareDosar).toBe(DERIVED_STATUS_DECIDED);
  });

  it("keeps realistic long solution summaries intact (the end often holds appeal rights)", () => {
    const text = `${"Admite cererea. ".repeat(320)}Cu drept de apel în 30 de zile de la comunicare.`; // ~5.2k chars, as observed live
    const long = { ...dosar, obiect: "x".repeat(2000), sedinte: [{ ...dosar.sedinte[1], solutieSumar: text }] };
    const n = normalizeCourtCase(mapPortalDosarToRaw(long));
    expect(n.kind).toBe("complete");
    if (n.kind === "complete") expect(n.data.hearings[0].solutionText!.endsWith("de la comunicare.")).toBe(true);
  });

  it("still bounds pathological texts instead of rejecting the response", () => {
    const huge = { ...dosar, sedinte: [{ ...dosar.sedinte[1], solutieSumar: "z".repeat(50_000) }] };
    expect(normalizeCourtCase(mapPortalDosarToRaw(huge)).kind).toBe("complete");
  });

  it("normalizes hours and applies the Europe/Bucharest offset (EET/EEST)", () => {
    expect(normalizeHour("9:00")).toBe("09:00");
    expect(normalizeHour("09.30")).toBe("09:30");
    expect(normalizeHour("25:00")).toBeNull();
    expect(normalizeHour("")).toBeNull();
    expect(withBucharestOffset("2026-01-15T10:00:00")).toBe("2026-01-15T10:00:00+02:00");
    expect(withBucharestOffset("2026-07-15T10:00:00")).toBe("2026-07-15T10:00:00+03:00");
    expect(withBucharestOffset("garbage")).toBeNull();
  });
});

describe("court name → portal institution", () => {
  it.each([
    ["Tribunalul București", "TribunalulBUCURESTI"],
    ["TRIBUNALUL BUCUREȘTI", "TribunalulBUCURESTI"],
    ["Judecătoria Sectorului 1 București", "JudecatoriaSECTORUL1BUCURESTI"],
    ["Judecătoria Cluj-Napoca", "JudecatoriaCLUJNAPOCA"],
    ["Curtea de Apel Cluj", "CurteadeApelCLUJ"],
    ["TribunalulCLUJ", "TribunalulCLUJ"],
  ])("%s → %s", (input, expected) => {
    expect(resolvePortalInstitution(input)).toBe(expected);
  });

  it("returns null rather than guessing", () => {
    expect(resolvePortalInstitution("Tribunalul Atlantida")).toBeNull();
    expect(resolvePortalInstitution("Tribunalul")).toBeNull();
    expect(resolvePortalInstitution("")).toBeNull();
  });

  it("has the full generated list (246 values from the WSDL)", () => {
    expect(PORTAL_INSTITUTIONS.length).toBe(246);
  });
});

describe("PortalJustSoapProvider behaviour (fake transport, no network)", () => {
  const base: PortalJustSoapConfig = {
    endpoint: "https://portalquery.just.ro/query.asmx",
    integrationApproved: true,
    minPollingIntervalMinutes: 60,
    timeoutMs: 2000,
    minRequestGapMs: 0,
  };
  const respond = (status: number, body = "") =>
    vi.fn<typeof fetch>(async () => new Response(body, { status, headers: { "content-type": "text/xml" } }));

  it("never touches the network when disabled or over plain HTTP", async () => {
    const f = respond(200, FIXTURE);
    expect(await new PortalJustSoapProvider({ ...base, integrationApproved: false, fetchImpl: f }).fetchCase(query)).toMatchObject({
      kind: "error",
      errorCode: "provider_disabled",
    });
    expect(
      await new PortalJustSoapProvider({ ...base, endpoint: "http://portalquery.just.ro/query.asmx", fetchImpl: f }).fetchCase(query),
    ).toMatchObject({ kind: "error", errorCode: "insecure_transport_refused" });
    expect(f).not.toHaveBeenCalled();
  });

  it("refuses to query when the court cannot be identified", async () => {
    const f = respond(200, FIXTURE);
    const r = await new PortalJustSoapProvider({ ...base, fetchImpl: f }).fetchCase({ ...query, courtName: "Instanța X" });
    expect(r).toMatchObject({ kind: "error", errorCode: "court_not_recognized" });
    expect(f).not.toHaveBeenCalled();
  });

  it("sends a correct SOAP request with no redirects allowed", async () => {
    const f = respond(200, FIXTURE);
    await new PortalJustSoapProvider({ ...base, fetchImpl: f }).fetchCase(query);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(base.endpoint);
    expect(init!.method).toBe("POST");
    expect(init!.redirect).toBe("error");
    expect((init!.headers as Record<string, string>).SOAPAction).toBe('"portalquery.just.ro/CautareDosare"');
    expect(String(init!.body)).toContain("<numarDosar>1234/3/2026</numarDosar>");
    expect(String(init!.body)).toContain("<institutie>TribunalulBUCURESTI</institutie>");
  });

  it("returns the exact matching file (not the /a1 incident file)", async () => {
    const r = await new PortalJustSoapProvider({ ...base, fetchImpl: respond(200, FIXTURE) }).fetchCase(query);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.source).toMatchObject({ provider: "portaljust_soap", transport: "https" });
      const n = normalizeCourtCase(r.payload);
      expect(n.kind === "complete" && n.data.courtCaseNumber).toBe("1234/3/2026");
    }
  });

  it.each([
    [525, "unavailable"],
    [503, "unavailable"],
    [429, "unavailable"],
    [404, "error"],
  ])("HTTP %i → %s (never 'no changes')", async (status, kind) => {
    const r = await new PortalJustSoapProvider({ ...base, fetchImpl: respond(status, "error code: 525") }).fetchCase(query);
    expect(r.kind).toBe(kind);
  });

  it("maps malformed XML, unknown files and duplicates to explicit errors", async () => {
    expect(await new PortalJustSoapProvider({ ...base, fetchImpl: respond(200, "<html>Just a moment...") }).fetchCase(query)).toMatchObject({
      errorCode: "invalid_response",
    });
    expect(
      await new PortalJustSoapProvider({ ...base, fetchImpl: respond(200, FIXTURE) }).fetchCase({ ...query, courtCaseNumber: "9/9/2026" }),
    ).toMatchObject({ errorCode: "case_not_found_at_source" });
    const dup = FIXTURE.replace("<numar>1234/3/2026/a1</numar>", "<numar>1234/3/2026</numar>");
    expect(await new PortalJustSoapProvider({ ...base, fetchImpl: respond(200, dup) }).fetchCase(query)).toMatchObject({
      errorCode: "ambiguous_source_result",
    });
  });

  it("reports timeouts and network failures", async () => {
    const slow = vi.fn<typeof fetch>(
      (_u, init) =>
        new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" })))),
    );
    expect(await new PortalJustSoapProvider({ ...base, timeoutMs: 50, fetchImpl: slow }).fetchCase(query)).toMatchObject({
      errorCode: "provider_timeout",
    });
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await new PortalJustSoapProvider({ ...base, fetchImpl: down }).fetchCase(query)).kind).toBe("unavailable");
  });

  it("serializes requests with a minimum gap", async () => {
    const times: number[] = [];
    const f = vi.fn<typeof fetch>(async () => {
      times.push(Date.now());
      return new Response(FIXTURE, { status: 200 });
    });
    const p = new PortalJustSoapProvider({ ...base, minRequestGapMs: 150, fetchImpl: f });
    await Promise.all([p.fetchCase(query), p.fetchCase(query), p.fetchCase(query)]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(140);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(140);
  });

  it("declares a per-file minimum interval for the monitoring service", () => {
    expect(new PortalJustSoapProvider(base).minIntervalMs).toBe(60 * 60_000);
  });
});
