import "server-only";
import { label } from "@/i18n";
import {
  duplicateKey,
  parseCaseImport,
  prepareImportRows,
  type ImportAssignee,
  type PreparedRow,
} from "@/lib/case-import";
import { fail, logServerError, type ActionResult } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import type { ImportOutcome, ImportPreview, ImportPreviewRow as PreviewRow } from "@/lib/shared-types";
import type { Json } from "@/lib/supabase/database.types";
import { caseImportSchema } from "@/lib/validation";
import { roleIn, type AuthContext } from "@/server/context";
import { listMembers } from "./organizations";

/**
 * Bulk case import, in two steps that each re-read the submitted text:
 *   preview → nothing is written; every row is checked and explained;
 *   import  → the same checks run again, then the ready rows are inserted
 *             through public.import_cases() as the caller (RLS applies).
 */

export type { ImportOutcome, ImportPreview } from "@/lib/shared-types";

type Analysis = { prepared: PreparedRow[]; problems: Map<number, string[]>; header: boolean; names: Map<string, string> };

async function analyze(ctx: AuthContext, input: unknown): Promise<{ ok: false; result: ActionResult<never> } | ({ ok: true } & Analysis)> {
  if (!ctx.activeOrg) return { ok: false, result: fail(ctx.t, "forbidden") };
  const orgId = ctx.activeOrg.organizationId;
  const role = roleIn(ctx, orgId);
  if (role !== "admin" && role !== "lawyer") {
    return { ok: false, result: fail(ctx.t, "forbidden", ctx.t.errors.assistantsCannotCreateCases) };
  }

  const parsed = caseImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, result: fail(ctx.t, "validation", ctx.t.caseImport.parseErrors.too_large) };

  const table = parseCaseImport(parsed.data.data);
  if (!table.ok) return { ok: false, result: fail(ctx.t, "validation", ctx.t.caseImport.parseErrors[table.error]) };

  // Who can be named in the "lawyer" column: active admins and lawyers (admins only).
  const members = await listMembers(ctx, orgId);
  const names = new Map(members.map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || "—"]));
  const assignable: ImportAssignee[] = members
    .filter((m) => m.status === "active" && m.role !== "assistant")
    .map((m) => ({ userId: m.user_id, email: m.profiles?.email ?? "", name: m.profiles?.full_name ?? null }));

  let defaultAssigneeId: string | null;
  if (role === "admin") {
    defaultAssigneeId = parsed.data.defaultAssigneeId;
    if (defaultAssigneeId && !assignable.some((a) => a.userId === defaultAssigneeId)) {
      return { ok: false, result: fail(ctx.t, "validation", ctx.t.errors.invalidAssignee) };
    }
  } else {
    defaultAssigneeId = ctx.user.id; // lawyers import cases for themselves
  }

  const prepared = prepareImportRows(table.rows, {
    assignees: role === "admin" ? assignable : [],
    defaultAssigneeId,
    ignoreLawyerColumn: role !== "admin",
    defaultTitle: (n) => ctx.t.caseImport.defaultTitle.replace("{number}", n),
  });

  const problems = new Map<number, string[]>();
  for (const row of prepared) {
    if (row.issues.length) problems.set(row.line, row.issues.map((issue) => ctx.t.caseImport.issues[issue]));
  }

  // Already monitored (and visible to the caller). Cases the caller cannot
  // see are caught by the database's uniqueness rule at import time.
  const numbers = [...new Set(prepared.filter((r) => r.issues.length === 0).map((r) => r.courtCaseNumber))];
  const existing = new Set<string>();
  for (let i = 0; i < numbers.length; i += 100) {
    const { data, error } = await ctx.supabase
      .from("cases")
      .select("court_case_number, court_name")
      .eq("organization_id", orgId)
      .neq("status", "archived")
      .in("court_case_number", numbers.slice(i, i + 100));
    if (error) {
      logServerError("caseImport.existing", error);
      return { ok: false, result: fail(ctx.t, "internal") };
    }
    for (const c of data ?? []) existing.add(duplicateKey(c.court_case_number, c.court_name));
  }
  for (const row of prepared) {
    if (row.issues.length === 0 && existing.has(duplicateKey(row.courtCaseNumber, row.courtName))) {
      problems.set(row.line, [ctx.t.caseImport.issues.alreadyExists]);
    }
  }
  return { ok: true, prepared, problems, header: table.header, names };
}

export async function previewCaseImport(ctx: AuthContext, input: unknown): Promise<ActionResult<ImportPreview>> {
  if (!rateLimit(`import-preview:${ctx.user.id}`, 60, 10 * 60_000).ok) return fail(ctx.t, "rate_limited");
  const a = await analyze(ctx, input);
  if (!a.ok) return a.result;
  const rows: PreviewRow[] = a.prepared.map((r) => {
    const problems = a.problems.get(r.line) ?? [];
    return {
      line: r.line,
      courtCaseNumber: r.courtCaseNumber,
      courtName: r.courtName,
      title: r.title,
      titleDefaulted: r.titleDefaulted,
      matter: r.matterType ? label(ctx.t.labels.matterType, r.matterType) : "—",
      assignee: r.assignedUserId ? (a.names.get(r.assignedUserId) ?? "—") : ctx.t.common.unassigned,
      ready: problems.length === 0,
      problems,
    };
  });
  const ready = rows.filter((r) => r.ready).length;
  return { ok: true, data: { rows, ready, problems: rows.length - ready, header: a.header } };
}

export async function importCases(ctx: AuthContext, input: unknown): Promise<ActionResult<ImportOutcome>> {
  if (!rateLimit(`import:${ctx.user.id}`, LIMITS.caseImport.limit, LIMITS.caseImport.windowMs).ok) {
    return fail(ctx.t, "rate_limited");
  }
  const a = await analyze(ctx, input);
  if (!a.ok) return a.result;

  const ready = a.prepared.filter((r) => !a.problems.has(r.line));
  if (ready.length === 0) return fail(ctx.t, "validation", ctx.t.caseImport.nothingToImport);

  const payload = ready.map((r) => ({
    court_case_number: r.courtCaseNumber,
    court_name: r.courtName,
    title: r.title,
    matter_type: r.matterType,
    assigned_user_id: r.assignedUserId,
  }));
  const { data, error } = await ctx.supabase.rpc("import_cases", {
    p_organization_id: ctx.activeOrg!.organizationId,
    p_rows: payload as unknown as Json,
  });
  if (error) {
    logServerError("importCases", error);
    return fail(ctx.t, "internal");
  }

  const results = (data ?? []) as { index: number; id?: string; error?: "duplicate" | "forbidden" | "invalid" }[];
  const failed: ImportOutcome["failed"] = [];
  let imported = 0;
  for (const r of results) {
    const row = ready[r.index - 1];
    if (!row) continue;
    if (r.id) imported++;
    else failed.push({ line: row.line, courtCaseNumber: row.courtCaseNumber, reason: ctx.t.caseImport.importErrors[r.error ?? "invalid"] });
  }
  return { ok: true, data: { imported, skipped: a.prepared.length - ready.length, failed } };
}
