"use server";

import { revalidatePath } from "next/cache";
import { getT } from "@/i18n/server";
import { fail, type ActionResult } from "@/lib/errors";
import { getAuthContext } from "@/server/context";
import { createCalendarFeed, revokeCalendarFeed } from "@/server/dal/calendar";

/** Returns the new link once; it is not stored and cannot be shown again. */
export async function createCalendarFeedAction(): Promise<ActionResult<{ url: string }>> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await createCalendarFeed(ctx);
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return { ok: true, data: result.data, message: t.success.calendarLinkCreated };
}

export async function revokeCalendarFeedAction(): Promise<ActionResult> {
  const t = await getT();
  const ctx = await getAuthContext();
  if (!ctx) return fail(t, "unauthenticated");
  const result = await revokeCalendarFeed(ctx);
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return { ok: true, message: t.success.calendarLinkRevoked };
}
