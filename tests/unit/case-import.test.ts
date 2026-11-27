import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  IMPORT_MAX_ROWS,
  parseCaseImport,
  prepareImportRows,
  resolveMatterType,
  splitRecords,
  type PrepareOptions,
} from "@/lib/case-import";
import { base32Decode, hotp, totp } from "../helpers/totp";

/* Bulk import parsing and row checks (synthetic data). */

const options: PrepareOptions = {
  assignees: [
    { userId: "u-ana", email: "ana@example.com", name: "Ana Sintetic" },
    { userId: "u-dan", email: "dan@example.com", name: "Dan Sintetic" },
  ],
  defaultAssigneeId: null,
  ignoreLawyerColumn: false,
  defaultTitle: (n) => `Dosar ${n}`,
};

describe("case import: parsing", () => {
  it("reads a Romanian Excel CSV (semicolons, BOM, CRLF, diacritics in the header)", () => {
    const text = "﻿Număr dosar;Instanță;Titlu;Materie\r\n1234/3/2026;Tribunalul București;Client A;comercial\r\n";
    const r = parseCaseImport(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.delimiter).toBe(";");
    expect(r.header).toBe(true);
    expect(r.rows).toEqual([{ line: 2, number: "1234/3/2026", court: "Tribunalul București", title: "Client A", matter: "comercial", lawyer: "" }]);
  });

  it("reads cells pasted from a spreadsheet (tabs), headers in any order, unknown columns ignored", () => {
    const text = "Instanta\tObservații\tNr. dosar\nJudecătoria Cluj-Napoca\tx\t55/211/2026\n";
    const r = parseCaseImport(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.delimiter).toBe("\t");
    expect(r.rows[0]).toMatchObject({ number: "55/211/2026", court: "Judecătoria Cluj-Napoca", title: "" });
  });

  it("without a header, the first column must be a case number and the default order applies", () => {
    const r = parseCaseImport("1234/3/2026,Tribunalul București,Client A\n");
    if (!r.ok) throw new Error(r.error);
    expect(r.header).toBe(false);
    expect(r.rows[0]).toMatchObject({ line: 1, number: "1234/3/2026", title: "Client A" });
    expect(parseCaseImport("Client;Court\nA;B")).toEqual({ ok: false, error: "no_number_column" });
  });

  it("handles quoted fields with delimiters, quotes and line breaks", () => {
    const { records, balanced } = splitRecords('a;"b;c";"say ""hi""";"two\nlines"\nx;y', ";");
    expect(balanced).toBe(true);
    expect(records).toEqual([
      { line: 1, cells: ["a", "b;c", 'say "hi"', "two\nlines"] },
      { line: 3, cells: ["x", "y"] },
    ]);
    expect(parseCaseImport('Număr dosar;Titlu\n1/1/2026;"unclosed')).toEqual({ ok: false, error: "unbalanced_quotes" });
  });

  it("rejects empty, too large and too long inputs", () => {
    expect(parseCaseImport("  \n ")).toEqual({ ok: false, error: "empty" });
    expect(parseCaseImport("x".repeat(200_001))).toEqual({ ok: false, error: "too_large" });
    const many = ["Număr dosar;Instanță", ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `${i + 1}/3/2026;Tribunalul București`)];
    expect(parseCaseImport(many.join("\n"))).toEqual({ ok: false, error: "too_many_rows" });
  });

  it("detects the delimiter from the first line", () => {
    expect(detectDelimiter("a\tb;c")).toBe("\t");
    expect(detectDelimiter("a;b,c;d")).toBe(";");
    expect(detectDelimiter("a,b,c")).toBe(",");
  });
});

describe("case import: row checks", () => {
  it("recognizes matter types in both languages and common Romanian terms", () => {
    expect(resolveMatterType("")).toBe("civil");
    expect(resolveMatterType("Litigii de muncă")).toBe("labor");
    expect(resolveMatterType("contencios administrativ și fiscal")).toBe("administrative");
    expect(resolveMatterType("Insolvență")).toBe("insolvency");
    expect(resolveMatterType("Enforcement")).toBe("enforcement");
    expect(resolveMatterType("astrologie")).toBeNull();
  });

  it("explains every problem and never invents data", () => {
    const r = parseCaseImport(
      [
        "Număr dosar;Instanță;Titlu;Materie;Avocat",
        "1234/3/2026;Tribunalul București;;civil;ANA@example.com",
        "1234/3/2026;tribunalul bucurești;Repetat;civil;",
        "12-34;;Client;astrologie;nimeni@example.com",
        "77/3/2026;Tribunalul București;Client;penal;Dan Sintetic",
      ].join("\n"),
    );
    if (!r.ok) throw new Error(r.error);
    const rows = prepareImportRows(r.rows, options);
    expect(rows[0]).toMatchObject({ title: "Dosar 1234/3/2026", titleDefaulted: true, assignedUserId: "u-ana", issues: [] });
    expect(rows[1].issues).toEqual(["duplicateInFile"]);
    expect(rows[2].issues).toEqual(["numberInvalid", "courtMissing", "matterUnknown", "lawyerUnknown"]);
    expect(rows[3]).toMatchObject({ matterType: "criminal", assignedUserId: "u-dan", issues: [] });
  });

  it("lawyers import for themselves: the lawyer column is ignored", () => {
    const r = parseCaseImport("Număr dosar;Instanță;Avocat\n1/3/2026;Tribunalul București;altcineva@example.com");
    if (!r.ok) throw new Error(r.error);
    const [row] = prepareImportRows(r.rows, { ...options, assignees: [], ignoreLawyerColumn: true, defaultAssigneeId: "u-self" });
    expect(row).toMatchObject({ assignedUserId: "u-self", issues: [] });
  });
});

describe("TOTP test helper (RFC 6238 vectors)", () => {
  it("matches the published SHA-1 test values", () => {
    const key = Buffer.from("12345678901234567890", "ascii");
    expect(hotp(key, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(hotp(key, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(hotp(key, Math.floor(20000000000 / 30), 8)).toBe("65353130");
    // Same key in base32, as authenticator apps receive it.
    expect(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").equals(key)).toBe(true);
    expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000, 8)).toBe("94287082");
  });
});
