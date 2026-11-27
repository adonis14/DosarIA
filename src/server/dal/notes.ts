import "server-only";
import { classifyDbError, fail, logServerError, type ActionResult } from "@/lib/errors";
import { caseNoteSchema, fieldErrorsOf, uuid } from "@/lib/validation";
import type { CaseNoteRow } from "@/lib/shared-types";
import type { AuthContext } from "@/server/context";
import { getAuthorizedCase } from "./cases";

/**
 * Case notes. Team notes are visible to everyone who can read the case;
 * private notes only to their author (enforced by RLS). Only the author
 * edits or deletes a note. Note text stays in the database: it is never put
 * in audit entries, notifications, the calendar feed, logs or AI prompts.
 */

export type { CaseNoteRow } from "@/lib/shared-types";

const NOTE_COLUMNS = "id, case_id, author_id, body, visibility, created_at, updated_at";

export async function listCaseNotes(ctx: AuthContext, caseId: string): Promise<CaseNoteRow[]> {
  const id = uuid.safeParse(caseId);
  if (!id.success) return [];
  const { data, error } = await ctx.supabase
    .from("case_notes")
    .select(NOTE_COLUMNS)
    .eq("case_id", id.data)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    logServerError("listCaseNotes", error);
    throw new Error("Could not load notes");
  }
  return (data ?? []) as CaseNoteRow[];
}

export async function addCaseNote(ctx: AuthContext, caseId: string, input: unknown): Promise<ActionResult> {
  const parsed = caseNoteSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));
  const existing = await getAuthorizedCase(ctx, caseId);
  if (!existing) return fail(ctx.t, "not_found");

  const { error } = await ctx.supabase.from("case_notes").insert({
    organization_id: existing.organization_id,
    case_id: existing.id,
    body: parsed.data.body,
    visibility: parsed.data.visibility,
  });
  if (error) {
    const code = classifyDbError(error);
    if (code !== "forbidden" && code !== "validation") logServerError("addCaseNote", error);
    return fail(ctx.t, code);
  }
  return { ok: true, message: ctx.t.success.noteAdded };
}

/** Returns the note's case id, for revalidation. Someone else's note behaves as not found. */
export async function updateCaseNote(ctx: AuthContext, noteId: string, input: unknown): Promise<ActionResult<{ caseId: string }>> {
  const id = uuid.safeParse(noteId);
  if (!id.success) return fail(ctx.t, "not_found");
  const parsed = caseNoteSchema.safeParse(input);
  if (!parsed.success) return fail(ctx.t, "validation", undefined, fieldErrorsOf(parsed.error, ctx.t));

  const { data, error } = await ctx.supabase
    .from("case_notes")
    .update({ body: parsed.data.body, visibility: parsed.data.visibility })
    .eq("id", id.data)
    .eq("author_id", ctx.user.id)
    .select("case_id")
    .maybeSingle();
  if (error) {
    logServerError("updateCaseNote", error);
    return fail(ctx.t, classifyDbError(error));
  }
  if (!data) return fail(ctx.t, "not_found", ctx.t.errors.noteNotYours);
  return { ok: true, data: { caseId: data.case_id }, message: ctx.t.success.noteUpdated };
}

export async function deleteCaseNote(ctx: AuthContext, noteId: string): Promise<ActionResult<{ caseId: string }>> {
  const id = uuid.safeParse(noteId);
  if (!id.success) return fail(ctx.t, "not_found");
  const { data, error } = await ctx.supabase
    .from("case_notes")
    .delete()
    .eq("id", id.data)
    .eq("author_id", ctx.user.id)
    .select("case_id");
  if (error) {
    logServerError("deleteCaseNote", error);
    return fail(ctx.t, classifyDbError(error));
  }
  if (!data?.length) return fail(ctx.t, "not_found", ctx.t.errors.noteNotYours);
  return { ok: true, data: { caseId: data[0].case_id } };
}
