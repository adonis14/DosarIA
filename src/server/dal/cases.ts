import "server-only";
import { fail, classifyDbError, logServerError, type ActionResult } from "@/lib/errors";
import {
  assignCaseSchema,
  caseFiltersSchema,
  createCaseSchema,
  fieldErrorsOf,
  updateCaseSchema,
  uuid,
  type CaseFilters,
} from "@/lib/validation";
import { isAdminOf, roleIn, type AuthContext } from "@/server/context";
import { logSecurityEvent } from "./audit";

/**
 * Case data access. Every function:
 *   - takes the verified AuthContext (identity from the server session),
 *   - validates input with Zod,
 *   - queries through the user's RLS-scoped client (the database is the
 *     final authority; app checks give clear errors and defence in depth),
 *   - never accepts organization_id from the client for authorization.
 */

const CASE_COLUMNS =
  "id, organization_id, court_case_number, court_name, title, matter_type, status, assigned_user_id, assigned_assistant_id, court_status, last_check_attempt_at, last_successful_check_at, last_check_outcome, archived_at, created_at, updated_at";

export type CaseRow = {
  id: string;
  organization_id: string;
  court_case_number: string;
  court_name: string;
  title: string;
  matter_type: string;
  status: "active" | "closed" | "archived";
  assigned_user_id: string | null;
  assigned_assistant_id: string | null;
  court_status: string | null;
  last_check_attempt_at: string | null;
  last_successful_check_at: string | null;
  last_check_outcome: "never_checked" | "changes_detected" | "no_changes" | "failed" | "incomplete" | "source_unavailable";
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Cases of the active organization that the caller may see (RLS-filtered). */
export async function getAuthorizedCases(ctx: AuthContext, rawFilters: Partial<CaseFilters> = {}): Promise<CaseRow[]> {
  if (!ctx.activeOrg) return [];
  const filters = caseFiltersSchema.parse(rawFilters);

  // Label filter: an inner join on the case's labels (RLS applies to both tables).
  const columns: string =
    filters.label === "all" ? CASE_COLUMNS : `${CASE_COLUMNS}, label_filter:case_label_assignments!inner(label_id)`;
  let query = ctx.supabase
    .from("cases")
    .select(columns)
    // UX scoping to the selected organization. Authorization is RLS.
    .eq("organization_id", ctx.activeOrg.organizationId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (filters.label !== "all") query = query.eq("label_filter.label_id", filters.label);
  if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.matterType !== "all") query = query.eq("matter_type", filters.matterType);
  if (filters.assignee === "me") query = query.eq("assigned_user_id", ctx.user.id);
  else if (filters.assignee === "unassigned") query = query.is("assigned_user_id", null);
  else if (filters.assignee !== "all") query = query.eq("assigned_user_id", filters.assignee);
  if (filters.q) {
    // Validated to letters/digits/space / - . only, so it cannot alter the filter grammar.
    const term = `%${filters.q}%`;
    query = query.or(`title.ilike.${term},court_case_number.ilike.${term},court_name.ilike.${term}`);
  }

  const { data, error } = await query;
  if (error) {
    logServerError("getAuthorizedCases", error);
    throw new Error("Could not load cases");
  }
  return ((data ?? []) as unknown as (CaseRow & { label_filter?: unknown })[]).map((row) => {
    delete row.label_filter;
    return row;
  });
}

/**
 * One case, if and only if the caller may read it. Unknown ids and ids of
 * cases the caller may not see are indistinguishable (both return null), so
 * the response never confirms that another tenant's case exists.
 */
export async function getAuthorizedCase(ctx: AuthContext, caseId: string): Promise<CaseRow | null> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return null;
  const { data, error } = await ctx.supabase.from("cases").select(CASE_COLUMNS).eq("id", id.data).maybeSingle();
  if (error) {
    logServerError("getAuthorizedCase", error);
    throw new Error("Could not load case");
  }
  if (!data) {
    await logSecurityEvent(ctx, {
      action: "security.case_access_denied",
      resourceType: "case",
      resourceId: id.data,
    });
    return null;
  }
  return data as CaseRow;
}

/** May the caller edit this case's details? (admin of its org, or its assigned lawyer) */
export function canEditCase(ctx: AuthContext, c: Pick<CaseRow, "organization_id" | "assigned_user_id">): boolean {
  const role = roleIn(ctx, c.organization_id);
  return role === "admin" || (role === "lawyer" && c.assigned_user_id === ctx.user.id);
}

export async function createCase(ctx: AuthContext, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!ctx.activeOrg) return fail(ctx.t, "forbidden");
  const parsed = createCaseSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const orgId = ctx.activeOrg.organizationId;
  const role = roleIn(ctx, orgId);
  if (role !== "admin" && role !== "lawyer") return fail(ctx.t, "forbidden", ctx.t.errors.assistantsCannotCreateCases);

  // Lawyers can only create cases assigned to themselves; assignment of
  // others is an admin-only operation (also enforced by RLS).
  const assignedUserId = role === "admin" ? parsed.data.assignedUserId : ctx.user.id;
  const assignedAssistantId = role === "admin" ? parsed.data.assignedAssistantId : null;

  const { data, error } = await ctx.supabase
    .from("cases")
    .insert({
      organization_id: orgId,
      court_case_number: parsed.data.courtCaseNumber,
      court_name: parsed.data.courtName,
      title: parsed.data.title,
      matter_type: parsed.data.matterType,
      assigned_user_id: assignedUserId,
      assigned_assistant_id: assignedAssistantId,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();

  if (error) {
    const code = classifyDbError(error);
    if (code === "conflict") return fail(ctx.t, "conflict", ctx.t.errors.caseAlreadyMonitored);
    if (code !== "validation") logServerError("createCase", error);
    return fail(ctx.t, code);
  }
  return { ok: true, data: { id: data.id } };
}

export async function updateCase(ctx: AuthContext, caseId: string, input: unknown): Promise<ActionResult> {
  const parsed = updateCaseSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const existing = await getAuthorizedCase(ctx, caseId);
  if (!existing) return fail(ctx.t, "not_found");
  if (!canEditCase(ctx, existing)) return fail(ctx.t, "forbidden");

  // Only these columns are written; protected columns are never part of the payload.
  const { data, error } = await ctx.supabase
    .from("cases")
    .update({
      court_case_number: parsed.data.courtCaseNumber,
      court_name: parsed.data.courtName,
      title: parsed.data.title,
      matter_type: parsed.data.matterType,
      status: parsed.data.status,
    })
    .eq("id", existing.id)
    .select("id")
    .maybeSingle();

  if (error) {
    const code = classifyDbError(error);
    if (code === "conflict") return fail(ctx.t, "conflict", ctx.t.errors.activeCaseNumberExists);
    logServerError("updateCase", error);
    return fail(ctx.t, code);
  }
  if (!data) return fail(ctx.t, "forbidden");
  return { ok: true };
}

export async function archiveCase(ctx: AuthContext, caseId: string): Promise<ActionResult> {
  const existing = await getAuthorizedCase(ctx, caseId);
  if (!existing) return fail(ctx.t, "not_found");
  if (!canEditCase(ctx, existing)) return fail(ctx.t, "forbidden");
  const { data, error } = await ctx.supabase
    .from("cases")
    .update({ status: "archived" })
    .eq("id", existing.id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) logServerError("archiveCase", error);
    return fail(ctx.t, error ? classifyDbError(error) : "forbidden");
  }
  return { ok: true };
}

/** Admin-only: change the responsible lawyer and/or assistant. */
export async function assignCase(ctx: AuthContext, caseId: string, input: unknown): Promise<ActionResult> {
  const parsed = assignCaseSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const existing = await getAuthorizedCase(ctx, caseId);
  if (!existing) return fail(ctx.t, "not_found");
  if (!isAdminOf(ctx, existing.organization_id)) {
    await logSecurityEvent(ctx, {
      action: "security.assignment_denied",
      resourceType: "case",
      resourceId: existing.id,
      organizationId: existing.organization_id,
    });
    return fail(ctx.t, "forbidden", ctx.t.errors.onlyAdminAssigns);
  }

  const { data, error } = await ctx.supabase
    .from("cases")
    .update({
      assigned_user_id: parsed.data.assignedUserId,
      assigned_assistant_id: parsed.data.assignedAssistantId,
    })
    .eq("id", existing.id)
    .select("id")
    .maybeSingle();

  if (error) {
    const code = classifyDbError(error);
    if (code === "validation") {
      return fail(ctx.t, "validation", ctx.t.errors.invalidAssignee);
    }
    logServerError("assignCase", error);
    return fail(ctx.t, code);
  }
  if (!data) return fail(ctx.t, "forbidden");
  return { ok: true };
}
