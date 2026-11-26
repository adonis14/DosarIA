import "server-only";
import { createHash } from "node:crypto";
import { getDictionary } from "@/i18n";
import { serverEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { buildCalendar, type IcsEvent } from "@/lib/ics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bucharestInstant } from "@/server/monitoring/calendar-ro";

/**
 * Private calendar feed (ICS). The link's token is the only credential: it is
 * hashed and passed to the service-role function public.calendar_feed, which
 * returns nothing for an unknown or revoked link or an inactive member, and
 * otherwise a marker row plus the items of the cases that person gets alerts
 * for.
 *
 * Calendar providers store what they fetch, so each event carries only the
 * case number and the court name, plus a link back to DosarIA (which requires
 * signing in). No titles, parties or court text.
 */

/** 32 random bytes, base64url: exactly 43 characters. */
export const CALENDAR_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function hashCalendarToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function parseTime(value: string | null): number | null {
  const m = value ? /^(\d{1,2}):(\d{2})$/.exec(value) : null;
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < 24 * 60 ? minutes : null;
}

/** The ICS text, or null when the link is not valid (the caller answers 404). */
export async function renderCalendarFeed(token: string): Promise<string | null> {
  if (!CALENDAR_TOKEN.test(token)) return null;
  const { data, error } = await createSupabaseAdminClient().rpc("calendar_feed", { p_token_hash: hashCalendarToken(token) });
  if (error) {
    logServerError("renderCalendarFeed", error);
    throw new Error("calendar feed failed");
  }
  if (!data?.some((row) => row.item_kind === "feed")) return null;

  // Calendar text is in Romanian: it lands in the lawyer's own calendar app.
  const t = getDictionary("ro").calendar;
  const appUrl = serverEnv().APP_URL.replace(/\/$/, "");
  const events: IcsEvent[] = [];
  for (const row of data) {
    if (row.item_kind === "feed" || !row.case_id || !row.item_date || !row.court_case_number) continue;
    const url = `${appUrl}/cases/${row.case_id}`;
    if (row.item_kind === "deadline") {
      events.push({
        uid: `deadline-${row.item_key}@dosaria`,
        summary: t.deadlineSummary(row.court_case_number),
        location: row.court_name ?? undefined,
        description: t.description(url),
        url,
        date: row.item_date,
      });
      continue;
    }
    const minutes = parseTime(row.item_time);
    events.push({
      uid: `hearing-${row.item_key}@dosaria`,
      summary: t.hearingSummary(row.court_case_number),
      location: row.court_name ?? undefined,
      description: t.description(url),
      url,
      ...(minutes === null ? { date: row.item_date } : { start: bucharestInstant(row.item_date, minutes), durationMinutes: 60 }),
    });
  }
  return buildCalendar({ name: t.name, events });
}
