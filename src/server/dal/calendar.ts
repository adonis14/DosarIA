import "server-only";
import { randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { classifyDbError, fail, logServerError, type ActionResult } from "@/lib/errors";
import type { AuthContext } from "@/server/context";
import { hashCalendarToken } from "@/server/calendar/feed";

/**
 * The caller's own private calendar link (user client, RLS). Only the token's
 * hash is stored; the full link is returned once, when it is created.
 */

export type CalendarFeedInfo = { id: string; created_at: string; last_used_at: string | null };

export async function getMyCalendarFeed(ctx: AuthContext): Promise<CalendarFeedInfo | null> {
  if (!ctx.activeOrg) return null;
  const { data, error } = await ctx.supabase
    .from("calendar_feeds")
    // token_hash is not granted to users: never select it.
    .select("id, created_at, last_used_at")
    .eq("organization_id", ctx.activeOrg.organizationId)
    .eq("user_id", ctx.user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    logServerError("getMyCalendarFeed", error);
    return null;
  }
  return data;
}

/** Create a new link for the active organization, revoking the previous one. */
export async function createCalendarFeed(ctx: AuthContext): Promise<ActionResult<{ url: string }>> {
  if (!ctx.activeOrg) return fail(ctx.t, "forbidden");
  const token = randomBytes(32).toString("base64url");
  const { error } = await ctx.supabase.rpc("replace_calendar_feed", {
    p_organization_id: ctx.activeOrg.organizationId,
    p_token_hash: hashCalendarToken(token),
  });
  if (error) {
    logServerError("createCalendarFeed", error);
    return fail(ctx.t, classifyDbError(error));
  }
  const appUrl = serverEnv().APP_URL.replace(/\/$/, "");
  return { ok: true, data: { url: `${appUrl}/api/calendar/${token}.ics` } };
}

export async function revokeCalendarFeed(ctx: AuthContext): Promise<ActionResult> {
  if (!ctx.activeOrg) return fail(ctx.t, "forbidden");
  const { error } = await ctx.supabase
    .from("calendar_feeds")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", ctx.activeOrg.organizationId)
    .eq("user_id", ctx.user.id)
    .is("revoked_at", null);
  if (error) {
    logServerError("revokeCalendarFeed", error);
    return fail(ctx.t, classifyDbError(error));
  }
  return { ok: true };
}
