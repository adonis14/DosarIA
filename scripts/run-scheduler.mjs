#!/usr/bin/env node
/**
 * LOCAL timer for automatic checks: calls the app's scheduler endpoint every
 * minute (or once with --once). In production a host cron does the same.
 *
 * Needs, in .env.local: APP_URL, SCHEDULED_CHECKS_ENABLED=true and
 * SCHEDULER_SECRET (32+ characters). The secret is sent only in the
 * Authorization header and is never printed.
 *
 *   npm run scheduler          # every 60 s until Ctrl+C
 *   npm run scheduler -- --once
 */
const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.SCHEDULER_SECRET;
const once = process.argv.includes("--once");

if (!secret || secret.length < 32) {
  console.error("SCHEDULER_SECRET (32+ characters) is not set in .env.local.");
  process.exit(1);
}
const url = new URL("/api/internal/scheduled-checks", appUrl);
if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error("Refusing to send the scheduler secret over plain HTTP to a non-local host.");
  process.exit(1);
}

async function tick() {
  const started = new Date().toISOString();
  try {
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const body = await res.text();
    console.log(`${started} HTTP ${res.status} ${body}`);
  } catch (err) {
    console.log(`${started} request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await tick();
if (!once) setInterval(tick, 60_000);
