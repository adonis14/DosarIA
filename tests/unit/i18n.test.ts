import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, getDictionary, interpolate, LOCALES, resolveLocale } from "@/i18n";
import {
  courtNameGloss,
  courtTermGloss,
  courtTermInline,
  displayCourtTerm,
  PORTAL_CATEGORIES,
  PORTAL_STAGES,
} from "@/i18n/court-terms";
import { en } from "@/i18n/dictionaries/en";
import { ro } from "@/i18n/dictionaries/ro";
import { formatDate } from "@/lib/format";
import { displayReminderText, SUGGESTED_REMINDER_TEXT } from "@/lib/suggested-reminder";
import { createCaseSchema, fieldErrorsOf, signupSchema, updatePasswordSchema } from "@/lib/validation";
import { summarizeDeterministically } from "@/server/summaries/deterministic";

/** Flatten a dictionary into "path → kind" pairs (kind: string | function | object). */
function shape(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, shape(v, path));
    else out[path] = typeof v;
  }
  return out;
}

/** All string leaves with their paths (keys may themselves contain dots, e.g. audit actions). */
function strings(value: unknown, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}/${k}` : k;
    if (typeof v === "string") out.push([path, v]);
    else if (v && typeof v === "object") out.push(...strings(v, path));
  }
  return out;
}

describe("dictionaries", () => {
  it("English and Romanian define exactly the same keys, with the same kinds", () => {
    expect(shape(ro)).toEqual(shape(en));
  });

  it("no message is empty", () => {
    for (const d of [en, ro]) for (const [path, s] of strings(d)) expect(s.trim(), path).not.toBe("");
  });

  it("client messages are plain strings (they are serialized to the browser)", () => {
    for (const d of [en, ro]) for (const kind of Object.values(shape(d.client))) expect(kind).toBe("string");
  });

  it("Romanian is the default and unknown values fall back to it", () => {
    expect(LOCALES).toEqual(["en", "ro"]);
    expect(DEFAULT_LOCALE).toBe("ro");
    expect(resolveLocale(undefined)).toBe("ro");
    expect(resolveLocale("fr")).toBe("ro");
    expect(resolveLocale("en")).toBe("en");
    expect(getDictionary("ro")).toBe(ro);
  });

  it("interpolates placeholders without touching unknown ones", () => {
    expect(interpolate("valid until {date} ({x})", { date: "1 May" })).toBe("valid until 1 May ({x})");
  });
});

describe("court terms: English gloss with the Romanian original kept", () => {
  it("glosses stages, statuses and outcomes, ignoring case and diacritic style", () => {
    expect(courtTermGloss("Fond")).toBe("First instance");
    expect(courtTermGloss("Amână pronunțarea")).toBe("Ruling postponed");
    expect(courtTermGloss("Alte soluţii")).toBe("Other outcome"); // cedilla ţ, as the portal publishes it
    expect(courtTermGloss("Termen preschimbat")).toBe("Hearing date changed");
    expect(courtTermGloss("Soluționat (dedus din ședințe)")).toBe("Decided (derived from hearings)");
  });

  it("covers every official stage (19) and category (11) from the portal WSDL, as codes and as display names", () => {
    expect(Object.keys(PORTAL_STAGES)).toHaveLength(19);
    expect(Object.keys(PORTAL_CATEGORIES)).toHaveLength(11);
    for (const [code, gloss] of [...Object.entries(PORTAL_STAGES), ...Object.entries(PORTAL_CATEGORIES)]) {
      expect(courtTermGloss(code)).toBe(gloss);
    }
    expect(courtTermGloss("Recurs în anulare")).toBe("Appeal for annulment");
    expect(courtTermGloss("Contestaţie în anulare/Fond")).toBe("Annulment challenge — first instance");
    expect(courtTermGloss("Recurs împotriva încheierii")).toBe("Appeal against an interim ruling (încheiere)");
    expect(courtTermGloss("Contencios administrativ şi fiscal")).toBe("Administrative and tax litigation");
    expect(courtTermGloss("Litigii de muncă")).toBe("Labour disputes");
    expect(courtTermGloss("Proprietate intelectuală")).toBe("Intellectual property");
    // Unknown wording is never guessed.
    expect(courtTermGloss("Etapă necunoscută")).toBeNull();
  });

  it("builds court-name glosses from the standard patterns", () => {
    expect(courtNameGloss("Tribunalul București")).toBe("Bucharest Tribunal");
    expect(courtNameGloss("Judecătoria Sectorului 1 București")).toBe("Bucharest Sector 1 District Court");
    expect(courtNameGloss("Curtea de Apel Cluj")).toBe("Cluj Court of Appeal");
    expect(courtNameGloss("Judecătoria Cluj-Napoca")).toBe("Cluj-Napoca District Court");
    expect(courtNameGloss("Înalta Curte de Casaţie şi Justiţie")).toBe("High Court of Cassation and Justice");
  });

  it("never guesses: unknown text is shown unchanged", () => {
    expect(courtTermGloss("Ceva necunoscut")).toBeNull();
    expect(displayCourtTerm("Ceva necunoscut", "en")).toEqual({ text: "Ceva necunoscut", original: null });
  });

  it("shows the gloss with the original in English, and the original only in Romanian", () => {
    expect(displayCourtTerm("Amână pronunțarea", "en")).toEqual({ text: "Ruling postponed", original: "Amână pronunțarea" });
    expect(displayCourtTerm("Amână pronunțarea", "ro")).toEqual({ text: "Amână pronunțarea", original: null });
    expect(courtTermInline("Tribunalul București", "en", "court")).toBe("Bucharest Tribunal (Tribunalul București)");
    expect(displayCourtTerm(null, "en")).toBeNull();
  });
});

describe("validation messages are translated per language", () => {
  it("length, password and mismatch messages", () => {
    const r = signupSchema.safeParse({ email: "a@example.com", password: "short", fullName: "x" });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(fieldErrorsOf(r.error, en).fullName).toEqual(["Name: at least 2 characters."]);
    expect(fieldErrorsOf(r.error, ro).fullName).toEqual(["Numele: minimum 2 caractere."]);
    expect(fieldErrorsOf(r.error, en).password).toContain("The password must be at least 12 characters long.");
    expect(fieldErrorsOf(r.error, ro).password).toContain("Parola trebuie să aibă cel puțin 12 caractere.");

    const m = updatePasswordSchema.safeParse({ password: "Valid-Password-1", confirmPassword: "Other-Password-1" });
    if (m.success) throw new Error("expected failure");
    expect(fieldErrorsOf(m.error, en).confirmPassword).toEqual(["The passwords do not match."]);
  });

  it("Zod's built-in messages become a generic translated message", () => {
    const r = createCaseSchema.safeParse({
      courtCaseNumber: "1/1/2026",
      courtName: "Tribunalul București",
      title: "Titlu",
      matterType: "space-law",
    });
    if (r.success) throw new Error("expected failure");
    expect(fieldErrorsOf(r.error, en).matterType).toEqual(["Invalid value."]);
    expect(fieldErrorsOf(r.error, ro).matterType).toEqual(["Valoare invalidă."]);
  });
});

describe("English summaries keep the court's original wording next to the gloss", () => {
  it("monitoring_started", () => {
    const s = summarizeDeterministically({
      type: "monitoring_started",
      eventKey: "0".repeat(64),
      occurredOn: null,
      details: { stage: "Fond", status: "În curs de judecată", next_hearing_date: null },
      requiresReview: false,
      suggestedReminderDate: null,
    });
    expect(s.en).toContain("Procedural stage: First instance (Fond); status: Pending trial (În curs de judecată).");
    expect(s.ro).toContain("Stadiu procesual: Fond; stare: În curs de judecată.");
  });
});

describe("dates and stored suggestion text", () => {
  it("formats calendar dates per language", () => {
    expect(formatDate("2026-12-19", "en")).toBe("19 December 2026");
    expect(formatDate("2026-12-19", "ro")).toBe("19 decembrie 2026");
  });

  it("shows unchanged suggested reminders in the reader's language, and user text as entered", () => {
    const suggested = { origin: "suggested", ...SUGGESTED_REMINDER_TEXT };
    expect(displayReminderText(suggested, en.caseDetail).title).toBe(en.caseDetail.suggestedReminderTitle);
    expect(displayReminderText(suggested, ro.caseDetail).title).toBe(SUGGESTED_REMINDER_TEXT.title);
    const manual = { origin: "manual", title: SUGGESTED_REMINDER_TEXT.title, description: null };
    expect(displayReminderText(manual, en.caseDetail).title).toBe(SUGGESTED_REMINDER_TEXT.title);
  });
});
