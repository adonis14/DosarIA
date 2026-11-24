import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson } from "@/server/monitoring/canonical";
import { detectChanges } from "@/server/monitoring/diff";
import { classifySolution, normalizeCourtCase, type NormalizedCase } from "@/server/monitoring/normalize";
import { MockCourtDataProvider } from "@/server/monitoring/providers/mock-provider";
import { PortalJustSoapProvider } from "@/server/monitoring/providers/portal-just-soap-provider";

const provider = new MockCourtDataProvider({ anchorDate: "2026-12-12", now: () => new Date("2026-11-25T10:00:00Z") });
const query = (attempt: number, courtCaseNumber = "1234/3/2026") => ({
  courtCaseNumber,
  courtName: "Tribunalul București",
  attempt,
});

async function stateAt(attempt: number, caseNumber?: string): Promise<NormalizedCase> {
  const result = await provider.fetchCase(query(attempt, caseNumber));
  if (result.kind !== "ok") throw new Error(`expected ok at attempt ${attempt}, got ${result.kind}`);
  const n = normalizeCourtCase(result.payload);
  if (n.kind !== "complete") throw new Error(`expected complete at attempt ${attempt}, got ${n.kind}`);
  return n.data;
}

describe("canonical hashing", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
    );
    expect(canonicalHash({ x: 1, y: 2 })).toBe(canonicalHash({ y: 2, x: 1 }));
  });

  it("differs when content differs and drops undefined", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    expect(canonicalHash({})).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normalization of untrusted provider payloads", () => {
  it("rejects payloads with wrong types as invalid", () => {
    const r = normalizeCourtCase({ numar: "1/1/2026", institutie: 42, sedinte: "n/a" });
    expect(r.kind).toBe("invalid");
  });

  it("rejects non-objects", () => {
    expect(normalizeCourtCase(null).kind).toBe("invalid");
    expect(normalizeCourtCase("<script>alert(1)</script>").kind).toBe("invalid");
  });

  it("flags missing required fields as incomplete (not as 'no changes')", () => {
    const r = normalizeCourtCase({ numar: "1/1/2026", institutie: "Tribunalul Cluj", stadiuProcesual: "Fond" });
    expect(r.kind).toBe("incomplete");
    if (r.kind === "incomplete") expect(r.missingFields).toEqual(["sedinte", "stareDosar"]);
  });

  it("sorts hearings chronologically and classifies solutions", () => {
    const r = normalizeCourtCase({
      numar: "1/1/2026",
      institutie: "Tribunalul Cluj",
      stadiuProcesual: "Fond",
      stareDosar: "În curs",
      sedinte: [
        { data: "2027-01-10", ora: "09:00" },
        { data: "2026-12-01", ora: "09:00", solutie: "Amână" },
      ],
    });
    expect(r.kind).toBe("complete");
    if (r.kind === "complete") {
      expect(r.data.hearings.map((h) => h.date)).toEqual(["2026-12-01", "2027-01-10"]);
      expect(r.data.hearings[0].solutionType).toBe("postponement");
    }
  });

  it("classifies Romanian solution wording", () => {
    expect(classifySolution("Amână pronunțarea")).toBe("postponement");
    expect(classifySolution("Admite în parte cererea")).toBe("decision");
    expect(classifySolution("Respinge acțiunea")).toBe("decision");
    expect(classifySolution("Suspendă judecata")).toBe("other");
    expect(classifySolution("")).toBeNull();
  });
});

describe("mock provider timeline and change detection", () => {
  it("is deterministic for the same inputs", async () => {
    const a = await provider.fetchCase(query(2));
    const b = await provider.fetchCase(query(2));
    expect(a.kind === "ok" && b.kind === "ok" && canonicalHash(a.payload) === canonicalHash(b.payload)).toBe(true);
  });

  it("baseline produces a single monitoring_started event with a suggested hearing date", async () => {
    const s0 = await stateAt(0);
    const events = detectChanges(null, s0, { previousHash: null, today: "2026-11-25" });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("monitoring_started");
    expect(events[0].suggestedReminderDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("detects no change between identical states", async () => {
    const s0 = await stateAt(0);
    const s1 = await stateAt(1);
    expect(canonicalHash(s0)).toBe(canonicalHash(s1));
    expect(detectChanges(s0, s1, { previousHash: canonicalHash(s0), today: "2026-11-25" })).toEqual([]);
  });

  it("detects a rescheduled hearing (previous → new date)", async () => {
    const s1 = await stateAt(1);
    const s2 = await stateAt(2);
    const events = detectChanges(s1, s2, { previousHash: canonicalHash(s1), today: "2026-11-25" });
    expect(events.map((e) => e.type)).toEqual(["hearing_rescheduled"]);
    const prev = events[0].details.previous_date!;
    const next = events[0].details.new_date!;
    expect(Date.parse(next) - Date.parse(prev)).toBe(7 * 86_400_000);
    expect(events[0].suggestedReminderDate).toBe(next);
  });

  it("simulates an unavailable source and incomplete data", async () => {
    expect((await provider.fetchCase(query(3))).kind).toBe("unavailable");
    const incomplete = await provider.fetchCase(query(4));
    expect(incomplete.kind).toBe("ok");
    if (incomplete.kind === "ok") expect(normalizeCourtCase(incomplete.payload).kind).toBe("incomplete");
  });

  it("detects postponement, decision, status and stage changes", async () => {
    const s2 = await stateAt(2);
    const s5 = await stateAt(5);
    const s6 = await stateAt(6);
    const s7 = await stateAt(7);
    expect(detectChanges(s2, s5, { previousHash: canonicalHash(s2), today: "2026-11-25" }).map((e) => e.type)).toEqual([
      "hearing_postponed",
    ]);
    expect(detectChanges(s5, s6, { previousHash: canonicalHash(s5), today: "2026-11-25" }).map((e) => e.type).sort()).toEqual(
      ["decision_issued", "status_changed"],
    );
    expect(detectChanges(s6, s7, { previousHash: canonicalHash(s6), today: "2026-11-25" }).map((e) => e.type).sort()).toEqual(
      ["hearing_scheduled", "stage_changed", "status_changed"],
    );
  });

  it("gives re-detected facts the same event key (deduplication)", async () => {
    const s1 = await stateAt(1);
    const s2 = await stateAt(2);
    const ctx = { previousHash: canonicalHash(s1), today: "2026-11-25" };
    expect(detectChanges(s1, s2, ctx)[0].eventKey).toBe(detectChanges(s1, s2, ctx)[0].eventKey);
  });

  it("flags a vanished hearing without replacement for human review", async () => {
    const s1 = await stateAt(1);
    const removed: NormalizedCase = { ...s1, hearings: s1.hearings.filter((h) => h.solutionType !== null) };
    const [event] = detectChanges(s1, removed, { previousHash: canonicalHash(s1), today: "2026-11-25" });
    expect(event.type).toBe("hearing_rescheduled");
    expect(event.details.new_date).toBeNull();
    expect(event.requiresReview).toBe(true);
  });

  it("supports special case numbers for failure simulation", async () => {
    expect((await provider.fetchCase(query(0, "9999/3/2026"))).kind).toBe("unavailable");
    expect((await provider.fetchCase(query(0, "9996/3/2026"))).kind).toBe("error");
    const malformed = await provider.fetchCase(query(0, "9998/3/2026"));
    expect(malformed.kind === "ok" && normalizeCourtCase(malformed.payload).kind).toBe("invalid");
  });

  it("returns only synthetic party names", async () => {
    const s0 = await stateAt(0);
    expect(s0.parties.every((p) => /(SRL|SA)$/.test(p.name))).toBe(true);
    expect(s0.parties[0].name).not.toBe(s0.parties[1].name);
  });
});

describe("PortalJustSoapProvider (inactive)", () => {
  it("refuses non-HTTPS endpoints without any network call", async () => {
    const p = new PortalJustSoapProvider({
      endpoint: "http://portalquery.just.ro/query.asmx",
      integrationApproved: true,
      minPollingIntervalMinutes: 240,
      timeoutMs: 1000,
    });
    const r = await p.fetchCase(query(0));
    expect(r).toMatchObject({ kind: "error", errorCode: "insecure_transport_refused" });
  });

  it("stays disabled even when configured with HTTPS", async () => {
    for (const approved of [false, true]) {
      const p = new PortalJustSoapProvider({
        endpoint: "https://portalquery.just.ro/query.asmx",
        integrationApproved: approved,
        minPollingIntervalMinutes: 240,
        timeoutMs: 1000,
      });
      expect(await p.fetchCase(query(0))).toMatchObject({ kind: "error", errorCode: "provider_disabled" });
    }
  });
});
