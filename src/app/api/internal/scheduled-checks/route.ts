import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { logServerError } from "@/lib/errors";
import { runDueChecks } from "@/server/monitoring/scheduler";

/**
 * POST /api/internal/scheduled-checks — runs one batch of due automatic checks.
 *
 * Called by a timer (cron on the host, or `npm run scheduler` locally), never
 * by browsers. It is not a user-facing route:
 * - 404 unless SCHEDULED_CHECKS_ENABLED=true and a secret is configured;
 * - 401 unless the request carries `Authorization: Bearer <SCHEDULER_SECRET>`
 *   (compared in constant time);
 * - 409 if a run is already in progress in this instance (the database lease
 *   also prevents overlap across instances);
 * - the response contains counts only, never case data.
 */

let running = false;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorized(header: string | null, secret: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const env = serverEnv();
  if (!env.SCHEDULED_CHECKS_ENABLED || !env.SCHEDULER_SECRET) return new Response(null, { status: 404 });
  if (!authorized(request.headers.get("authorization"), env.SCHEDULER_SECRET)) return json({ error: "unauthorized" }, 401);
  if (running) return json({ error: "already_running" }, 409);

  running = true;
  try {
    return json(await runDueChecks({ limit: env.SCHEDULER_BATCH_SIZE }));
  } catch (err) {
    logServerError("scheduled-checks", err);
    return json({ error: "internal" }, 500);
  } finally {
    running = false;
  }
}
