import { en } from "@/i18n/dictionaries/en";
import { ro } from "@/i18n/dictionaries/ro";
import { MATTER_TYPES, courtCaseNumber } from "@/lib/validation";

/**
 * Bulk case import: parsing and row validation (no database access).
 *
 * Input is text: a CSV file (comma or semicolon, as Romanian Excel saves it)
 * or cells copied straight from Excel / Google Sheets (tab-separated). No
 * spreadsheet library and no file upload to the server: the browser reads the
 * file as text and the server re-parses and re-validates it on every step.
 */

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_CHARS = 200_000;

export type ImportColumn = "number" | "court" | "title" | "matter" | "lawyer";
/** Column order assumed when the first row is data rather than a header. */
export const DEFAULT_COLUMNS: readonly ImportColumn[] = ["number", "court", "title", "matter", "lawyer"];

export type Delimiter = "\t" | ";" | ",";

export type RawImportRow = { line: number } & Record<ImportColumn, string>;

export type ParseError = "empty" | "too_large" | "too_many_rows" | "no_number_column" | "unbalanced_quotes";

export type ParseResult =
  | { ok: true; delimiter: Delimiter; header: boolean; columns: ImportColumn[]; rows: RawImportRow[] }
  | { ok: false; error: ParseError };

/** Lower-case, no diacritics, letters and digits only: "Număr dosar" → "numardosar". */
export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<ImportColumn, string[]> = {
  number: ["numardosar", "nrdosar", "numaruldosarului", "nrdosarului", "dosar", "numar", "nr", "casenumber", "caseno", "number", "case"],
  court: ["instanta", "instantadejudecata", "instanța", "court", "courtname"],
  title: ["titlu", "denumire", "descriere", "client", "nume", "title", "name", "description", "subject"],
  matter: ["materie", "materiejuridica", "tip", "tipdosar", "domeniu", "matter", "mattertype", "type"],
  lawyer: ["avocat", "avocatresponsabil", "responsabil", "emailavocat", "email", "lawyer", "assignedto", "lawyeremail"],
};

const headerLookup = new Map<string, ImportColumn>();
for (const [column, aliases] of Object.entries(HEADER_ALIASES) as [ImportColumn, string[]][]) {
  for (const alias of aliases) headerLookup.set(normalizeKey(alias), column);
}

export function headerColumn(cell: string): ImportColumn | null {
  return headerLookup.get(normalizeKey(cell)) ?? null;
}

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  if (count("\t") > 0) return "\t";
  const semicolons = count(";");
  const commas = count(",");
  if (semicolons > 0 && semicolons >= commas) return ";";
  return commas > 0 ? "," : ";";
}

/** RFC 4180 records: quoted fields may contain the delimiter, quotes ("") and line breaks. */
export function splitRecords(text: string, delimiter: Delimiter): { records: { line: number; cells: string[] }[]; balanced: boolean } {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let atFieldStart = true;
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    cells.push(field);
    field = "";
    atFieldStart = true;
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  if (field !== "" || cells.length > 0) endRecord();
  return { records, balanced: !inQuotes };
}

export function parseCaseImport(input: string): ParseResult {
  if (input.length > IMPORT_MAX_CHARS) return { ok: false, error: "too_large" };
  const text = input.replace(/^﻿/, "");
  if (text.trim() === "") return { ok: false, error: "empty" };

  const delimiter = detectDelimiter(text);
  const { records, balanced } = splitRecords(text, delimiter);
  if (!balanced) return { ok: false, error: "unbalanced_quotes" };
  const nonEmpty = records.filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { ok: false, error: "empty" };

  const first = nonEmpty[0];
  const mapped = first.cells.map(headerColumn);
  let header = false;
  let columns: (ImportColumn | null)[];
  if (mapped.includes("number")) {
    header = true;
    // The first column with a given meaning wins; unknown columns are ignored.
    const seen = new Set<ImportColumn>();
    columns = mapped.map((c) => (c && !seen.has(c) ? (seen.add(c), c) : null));
  } else if (courtCaseNumber.safeParse(first.cells[0] ?? "").success) {
    columns = [...DEFAULT_COLUMNS];
  } else {
    return { ok: false, error: "no_number_column" };
  }

  const data = header ? nonEmpty.slice(1) : nonEmpty;
  if (data.length > IMPORT_MAX_ROWS) return { ok: false, error: "too_many_rows" };

  const rows = data.map(({ line, cells }) => {
    const row: RawImportRow = { line, number: "", court: "", title: "", matter: "", lawyer: "" };
    columns.forEach((column, i) => {
      if (column) row[column] = (cells[i] ?? "").trim().replace(/\s+/g, " ");
    });
    return row;
  });
  return { ok: true, delimiter, header, columns: columns.filter((c): c is ImportColumn => c !== null), rows };
}

// ---------------------------------------------------------------------------
// Matter type: accepts codes, both languages' labels and common Romanian terms.
// ---------------------------------------------------------------------------
type MatterType = (typeof MATTER_TYPES)[number];

const MATTER_ALIASES: Record<MatterType, string[]> = {
  civil: ["civil", "civila"],
  commercial: ["comercial", "commercial", "societar", "litigiicuprofesionistii", "profesionisti"],
  labor: ["munca", "litigiidemunca", "conflictedemunca", "asigurarisociale", "labor", "labour"],
  administrative: ["contencios", "contenciosadministrativ", "contenciosadministrativsifiscal", "administrativ", "fiscal", "administrative"],
  family: ["familie", "minorisifamilie", "minori", "family"],
  enforcement: ["executare", "executaresilita", "enforcement"],
  insolvency: ["insolventa", "faliment", "insolvency"],
  criminal: ["penal", "criminal"],
  other: ["altele", "alta", "altul", "other"],
};

const matterLookup = new Map<string, MatterType>();
for (const type of MATTER_TYPES) {
  matterLookup.set(type, type);
  for (const alias of MATTER_ALIASES[type]) matterLookup.set(normalizeKey(alias), type);
  for (const dict of [ro, en]) matterLookup.set(normalizeKey(dict.labels.matterType[type]), type);
}

/** null = not recognized; "" (empty cell) = default "civil". */
export function resolveMatterType(value: string): MatterType | null {
  const key = normalizeKey(value);
  if (key === "") return "civil";
  return matterLookup.get(key) ?? null;
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------
export type RowIssue =
  | "numberInvalid"
  | "courtMissing"
  | "courtLength"
  | "titleLength"
  | "matterUnknown"
  | "lawyerUnknown"
  | "duplicateInFile";

export type ImportAssignee = { userId: string; email: string; name: string | null };

export type PreparedRow = {
  line: number;
  courtCaseNumber: string;
  courtName: string;
  title: string;
  /** The title was empty and a default was used. */
  titleDefaulted: boolean;
  matterType: MatterType | null;
  assignedUserId: string | null;
  issues: RowIssue[];
};

export type PrepareOptions = {
  /** Who may be named in the "lawyer" column (active admins and lawyers). Empty when the importer is a lawyer. */
  assignees: ImportAssignee[];
  /** Assignment for rows that name nobody, or for every row when the column is ignored. */
  defaultAssigneeId: string | null;
  /** Lawyers import cases for themselves: the "lawyer" column is ignored. */
  ignoreLawyerColumn: boolean;
  defaultTitle: (caseNumber: string) => string;
};

/** Duplicate key, as in the database's uniqueness rule (number + court, case-insensitive court). */
export function duplicateKey(courtCaseNumberValue: string, courtName: string): string {
  return `${courtCaseNumberValue}|${courtName.toLowerCase()}`;
}

export function prepareImportRows(rows: RawImportRow[], options: PrepareOptions): PreparedRow[] {
  const byEmail = new Map(options.assignees.map((a) => [a.email.toLowerCase(), a.userId]));
  const byName = new Map<string, string | null>();
  for (const a of options.assignees) {
    if (!a.name) continue;
    const key = normalizeKey(a.name);
    // Two members with the same name: ambiguous, so names do not resolve.
    byName.set(key, byName.has(key) ? null : a.userId);
  }
  const seen = new Set<string>();

  return rows.map((row) => {
    const issues: RowIssue[] = [];
    const number = courtCaseNumber.safeParse(row.number);
    if (!number.success) issues.push("numberInvalid");
    const courtName = row.court;
    if (courtName === "") issues.push("courtMissing");
    else if (courtName.length < 2 || courtName.length > 200) issues.push("courtLength");

    const caseNumber = number.success ? number.data : row.number;
    const titleDefaulted = row.title === "";
    const title = titleDefaulted ? options.defaultTitle(caseNumber) : row.title;
    if (title.length < 2 || title.length > 300) issues.push("titleLength");

    const matterType = resolveMatterType(row.matter);
    if (!matterType) issues.push("matterUnknown");

    let assignedUserId = options.defaultAssigneeId;
    if (!options.ignoreLawyerColumn && row.lawyer !== "") {
      const found = byEmail.get(row.lawyer.toLowerCase()) ?? byName.get(normalizeKey(row.lawyer)) ?? null;
      if (found) assignedUserId = found;
      else issues.push("lawyerUnknown");
    }

    if (number.success && courtName !== "") {
      const key = duplicateKey(caseNumber, courtName);
      if (seen.has(key)) issues.push("duplicateInFile");
      seen.add(key);
    }

    return { line: row.line, courtCaseNumber: caseNumber, courtName, title, titleDefaulted, matterType, assignedUserId, issues };
  });
}
