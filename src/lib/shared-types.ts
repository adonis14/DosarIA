import type { LABEL_COLORS } from "@/lib/validation";

/**
 * Data shapes shared by server modules and UI components. Kept here so that
 * components never import a server-only module, not even for a type.
 */

export type LabelColor = (typeof LABEL_COLORS)[number];
export type LabelRow = { id: string; name: string; color: LabelColor; created_by: string | null };

export type CaseNoteRow = {
  id: string;
  case_id: string;
  author_id: string;
  body: string;
  visibility: "team" | "private";
  created_at: string;
  updated_at: string;
};

export type ImportPreviewRow = {
  line: number;
  courtCaseNumber: string;
  courtName: string;
  title: string;
  titleDefaulted: boolean;
  matter: string;
  assignee: string;
  ready: boolean;
  problems: string[];
};
export type ImportPreview = { rows: ImportPreviewRow[]; ready: number; problems: number; header: boolean };
export type ImportOutcome = {
  imported: number;
  skipped: number;
  failed: { line: number; courtCaseNumber: string; reason: string }[];
};

export type MfaEnrollment = { factorId: string; qrCode: string; secret: string };
