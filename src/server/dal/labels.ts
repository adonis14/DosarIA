import "server-only";
import { classifyDbError, fail, logServerError, type ActionResult } from "@/lib/errors";
import type { LabelRow } from "@/lib/shared-types";
import { caseLabelsSchema, fieldErrorsOf, labelSchema, uuid } from "@/lib/validation";
import { roleIn, type AuthContext } from "@/server/context";
import { canEditCase, getAuthorizedCase } from "./cases";

/**
 * Case labels. The label list belongs to the organization (every member sees
 * it); attaching labels follows the case write rule (admin or assigned
 * lawyer). RLS enforces all of it; these checks give clear messages.
 */

export type { LabelColor, LabelRow } from "@/lib/shared-types";

export async function listLabels(ctx: AuthContext, organizationId: string): Promise<LabelRow[]> {
  const { data, error } = await ctx.supabase
    .from("case_labels")
    .select("id, name, color, created_by")
    .eq("organization_id", organizationId)
    .order("name", { ascending: true })
    .limit(200);
  if (error) {
    logServerError("listLabels", error);
    throw new Error("Could not load labels");
  }
  return data ?? [];
}

/** Label ids per case, for the given cases only (RLS-filtered). */
export async function getLabelIdsForCases(ctx: AuthContext, caseIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (caseIds.length === 0) return out;
  const { data, error } = await ctx.supabase
    .from("case_label_assignments")
    .select("case_id, label_id")
    .in("case_id", caseIds)
    .limit(5000);
  if (error) {
    logServerError("getLabelIdsForCases", error);
    throw new Error("Could not load labels");
  }
  for (const row of data ?? []) {
    const list = out.get(row.case_id) ?? [];
    list.push(row.label_id);
    out.set(row.case_id, list);
  }
  return out;
}

/** Admins manage every label; lawyers the labels they created. */
export function canManageLabel(ctx: AuthContext, organizationId: string, label: Pick<LabelRow, "created_by">): boolean {
  const role = roleIn(ctx, organizationId);
  return role === "admin" || (role === "lawyer" && label.created_by === ctx.user.id);
}

export function canCreateLabels(ctx: AuthContext, organizationId: string): boolean {
  const role = roleIn(ctx, organizationId);
  return role === "admin" || role === "lawyer";
}

export async function createLabel(ctx: AuthContext, input: unknown): Promise<ActionResult<{ id: string }>> {
  if (!ctx.activeOrg) return fail(ctx.t, "forbidden");
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));
  const orgId = ctx.activeOrg.organizationId;
  if (!canCreateLabels(ctx, orgId)) return fail(ctx.t, "forbidden");

  const { data, error } = await ctx.supabase
    .from("case_labels")
    .insert({ organization_id: orgId, name: parsed.data.name, color: parsed.data.color })
    .select("id")
    .single();
  if (error) {
    const code = classifyDbError(error);
    if (code === "conflict") return fail(ctx.t, "conflict", ctx.t.errors.labelExists, { name: [ctx.t.errors.labelExists] });
    if (code !== "forbidden") logServerError("createLabel", error);
    return fail(ctx.t, code);
  }
  return { ok: true, data: { id: data.id } };
}

async function getLabel(ctx: AuthContext, labelId: string) {
  const id = uuid.safeParse(labelId);
  if (!id.success) return null;
  const { data, error } = await ctx.supabase
    .from("case_labels")
    .select("id, organization_id, name, color, created_by")
    .eq("id", id.data)
    .maybeSingle();
  if (error) {
    logServerError("getLabel", error);
    return null;
  }
  return data;
}

export async function updateLabel(ctx: AuthContext, labelId: string, input: unknown): Promise<ActionResult> {
  const parsed = labelSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));
  const label = await getLabel(ctx, labelId);
  if (!label) return fail(ctx.t, "not_found");
  if (!canManageLabel(ctx, label.organization_id, label)) return fail(ctx.t, "forbidden", ctx.t.errors.labelNotYours);

  const { data, error } = await ctx.supabase
    .from("case_labels")
    .update({ name: parsed.data.name, color: parsed.data.color })
    .eq("id", label.id)
    .select("id")
    .maybeSingle();
  if (error) {
    const code = classifyDbError(error);
    if (code === "conflict") return fail(ctx.t, "conflict", ctx.t.errors.labelExists, { name: [ctx.t.errors.labelExists] });
    logServerError("updateLabel", error);
    return fail(ctx.t, code);
  }
  if (!data) return fail(ctx.t, "forbidden", ctx.t.errors.labelNotYours);
  return { ok: true };
}

export async function deleteLabel(ctx: AuthContext, labelId: string): Promise<ActionResult> {
  const label = await getLabel(ctx, labelId);
  if (!label) return fail(ctx.t, "not_found");
  if (!canManageLabel(ctx, label.organization_id, label)) return fail(ctx.t, "forbidden", ctx.t.errors.labelNotYours);
  const { data, error } = await ctx.supabase.from("case_labels").delete().eq("id", label.id).select("id");
  if (error) {
    logServerError("deleteLabel", error);
    return fail(ctx.t, classifyDbError(error));
  }
  if (!data?.length) return fail(ctx.t, "forbidden", ctx.t.errors.labelNotYours);
  return { ok: true };
}

/** Replace the set of labels on a case (only the difference is written). */
export async function setCaseLabels(ctx: AuthContext, caseId: string, input: unknown): Promise<ActionResult> {
  const parsed = caseLabelsSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation");
  const existing = await getAuthorizedCase(ctx, caseId);
  if (!existing) return fail(ctx.t, "not_found");
  if (!canEditCase(ctx, existing)) return fail(ctx.t, "forbidden", ctx.t.errors.onlyAssignedChangesLabels);

  const orgLabels = new Set((await listLabels(ctx, existing.organization_id)).map((l) => l.id));
  const wanted = new Set(parsed.data.labelIds);
  for (const id of wanted) if (!orgLabels.has(id)) return fail(ctx.t, "validation");

  const current = new Set((await getLabelIdsForCases(ctx, [existing.id])).get(existing.id) ?? []);
  const toRemove = [...current].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !current.has(id));

  if (toRemove.length > 0) {
    const { error } = await ctx.supabase
      .from("case_label_assignments")
      .delete()
      .eq("case_id", existing.id)
      .in("label_id", toRemove);
    if (error) {
      logServerError("setCaseLabels.delete", error);
      return fail(ctx.t, classifyDbError(error));
    }
  }
  if (toAdd.length > 0) {
    const { error } = await ctx.supabase
      .from("case_label_assignments")
      .insert(toAdd.map((labelId) => ({ organization_id: existing.organization_id, case_id: existing.id, label_id: labelId })));
    // A concurrent save may have added the same label already: that is the wanted state.
    if (error && error.code !== "23505") {
      logServerError("setCaseLabels.insert", error);
      return fail(ctx.t, classifyDbError(error));
    }
  }
  return { ok: true };
}
