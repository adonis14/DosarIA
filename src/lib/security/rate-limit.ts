/**
 * Minimal fixed-window rate limiter for sensitive endpoints (login, sign-up,
 * password reset, invitations, manual monitoring checks).
 *
 * LIMITATION: state is in process memory, so limits apply per server
 * instance and reset on restart. That is acceptable for a single-instance
 * pilot; a multi-instance deployment must move this to a shared store
 * (e.g. a Postgres table or the hosting platform's rate limiting). Supabase
 * Auth applies its own server-side rate limits in addition.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true };
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear();
}

export const LIMITS = {
  login: { limit: 10, windowMs: 15 * 60_000 },
  signup: { limit: 5, windowMs: 60 * 60_000 },
  passwordReset: { limit: 5, windowMs: 60 * 60_000 },
  invitation: { limit: 20, windowMs: 60 * 60_000 },
  monitoringPerCase: { limit: 1, windowMs: 5_000 },
  monitoringPerUser: { limit: 30, windowMs: 60_000 },
  securityLogPerActor: { limit: 30, windowMs: 60_000 },
  caseImport: { limit: 10, windowMs: 60 * 60_000 },
  /** Wrong codes per account; Supabase Auth limits verification attempts as well. */
  mfaVerify: { limit: 5, windowMs: 5 * 60_000 },
} as const;
