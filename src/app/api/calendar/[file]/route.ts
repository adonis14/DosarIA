import type { NextRequest } from "next/server";
import { logServerError } from "@/lib/errors";
import { rateLimit } from "@/lib/security/rate-limit";
import { hashCalendarToken, renderCalendarFeed } from "@/server/calendar/feed";

/**
 * GET /api/calendar/<token>.ics — a person's private calendar feed.
 *
 * Fetched by calendar apps (Google Calendar, Outlook), so there is no session:
 * the secret token in the URL is the credential. Unknown, revoked or
 * malformed links all get the same 404. The feed carries case numbers and
 * court names only.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/calendar/[file]">) {
  const { file } = await ctx.params;
  const token = file.endsWith(".ics") ? file.slice(0, -4) : "";
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!token) return notFound();

  // Calendar apps poll every few hours; anything faster is not a calendar app.
  const limited = rateLimit(`calendar:${hashCalendarToken(token).slice(0, 32)}`, 30, 60 * 60_000);
  if (!limited.ok) {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }

  try {
    const ics = await renderCalendarFeed(token);
    if (ics === null) return notFound();
    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="dosaria.ics"',
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    logServerError("calendarRoute", error);
    return new Response("Error", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
