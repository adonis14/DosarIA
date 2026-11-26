import { describe, expect, it } from "vitest";
import { buildClientNote, type ClientNoteInput } from "@/lib/client-note";

const base: Omit<ClientNoteInput, "eventType" | "details"> = {
  occurredOn: null,
  caseNumber: "1234/3/2026",
  courtName: "Tribunalul București",
  signer: "Avocat Sintetic",
};

describe("client note drafts (templates, no AI)", () => {
  it("a ruling quotes the court's exact wording and states no deadline", () => {
    const solution = "Admite în parte cererea. Obligă pârâta la plata sumei de 1.000 lei. Cu apel în 30 de zile de la comunicare.";
    const input = { ...base, eventType: "decision_issued", details: { hearing_date: "2026-11-10", solution_text: solution } };
    const ro = buildClientNote(input, "ro")!;
    const en = buildClientNote(input, "en")!;

    expect(ro).toContain("dosarul nr. 1234/3/2026 (Tribunalul București)");
    expect(ro).toContain("10 noiembrie 2026");
    expect(ro).toContain(`„${solution}”`); // verbatim
    expect(ro).toContain("de la comunicarea hotărârii");
    expect(ro.startsWith("Bună ziua,")).toBe(true);
    expect(ro.endsWith("Cu stimă,\nAvocat Sintetic")).toBe(true);

    expect(en).toContain("case no. 1234/3/2026");
    expect(en).toContain("10 November 2026");
    expect(en).toContain(`“${solution}”`); // the court's wording stays in Romanian
    expect(en).toContain("in Romanian");

    // The template itself never computes a date: the only dates are the hearing date and the court's text.
    const withoutQuote = ro.replace(solution, "");
    expect(withoutQuote.match(/\d{1,2} \p{L}+ \d{4}/gu)).toEqual(["10 noiembrie 2026"]);
  });

  it("a ruling without published wording still informs, without inventing any", () => {
    const ro = buildClientNote({ ...base, eventType: "decision_issued", occurredOn: "2026-11-10", details: { solution_text: null } }, "ro")!;
    expect(ro).toContain("instanța a pronunțat o hotărâre.");
    expect(ro).not.toContain("„");
  });

  it("postponements and moved hearings give the new date, or say it is not published yet", () => {
    const postponed = buildClientNote(
      { ...base, eventType: "hearing_postponed", details: { previous_date: "2026-12-12", new_date: "2027-01-09", solution_text: "Amână cauza" } },
      "ro",
    )!;
    expect(postponed).toContain("la termenul din 12 decembrie 2026, instanța a amânat judecarea cauzei.");
    expect(postponed).toContain("Următorul termen de judecată este 09 ianuarie 2027.");
    expect(postponed).toContain("„Amână cauza”");

    const moved = buildClientNote({ ...base, eventType: "hearing_rescheduled", details: { previous_date: "2026-12-12", new_date: null } }, "en")!;
    expect(moved).toContain("the hearing of 12 December 2026 has been moved.");
    expect(moved).toContain("has not been published yet");
  });

  it("new hearings, status and stage changes", () => {
    expect(
      buildClientNote({ ...base, eventType: "hearing_scheduled", details: { hearing_date: "2027-03-01", hearing_time: "09:00" } }, "ro"),
    ).toContain("a fost stabilit un termen de judecată pentru 01 martie 2027, ora 09:00.");
    expect(buildClientNote({ ...base, eventType: "stage_changed", details: { from: "Fond", to: "Apel" } }, "ro")).toContain(
      "dosarul a trecut în etapa „Apel”.",
    );
    expect(buildClientNote({ ...base, eventType: "status_changed", details: { to: "Soluționat" } }, "en")).toContain("“Soluționat”");
  });

  it("returns nothing when there is nothing to tell the client", () => {
    expect(buildClientNote({ ...base, eventType: "monitoring_started", details: { next_hearing_date: null } }, "ro")).toBeNull();
    expect(buildClientNote({ ...base, eventType: "hearing_scheduled", details: {} }, "ro")).toBeNull();
    expect(buildClientNote({ ...base, eventType: "unknown_type", details: {} }, "en")).toBeNull();
    expect(
      buildClientNote({ ...base, eventType: "monitoring_started", details: { next_hearing_date: "2026-12-12" } }, "ro"),
    ).toContain("următorul termen de judecată este 12 decembrie 2026.");
  });

  it("without a signer name the signature line is left for the lawyer", () => {
    const ro = buildClientNote({ ...base, signer: null, eventType: "stage_changed", details: { to: "Apel" } }, "ro")!;
    expect(ro.endsWith("Cu stimă,")).toBe(true);
  });
});
