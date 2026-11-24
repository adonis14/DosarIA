import { expect, test } from "@playwright/test";
import { testEnv } from "../helpers/env";
import { login, world } from "./helpers";

test.describe("unauthenticated access (Scenario F, through the app)", () => {
  for (const path of ["/dashboard", "/cases", "/settings", "/cases/new"]) {
    test(`${path} redirects to login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    });
  }

  test("a private case URL reveals nothing to an anonymous visitor", async ({ page, request }) => {
    const w = world();
    const res = await request.get(`/cases/${w.caseA1}`, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain("Pretenții");
    expect(body).not.toContain("1234/3/2026");
    await page.goto(`/cases/${w.caseA1}`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("1234/3/2026")).toHaveCount(0);
  });
});

test("security headers are present", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).not.toContain("unsafe-eval");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("authenticated pages are not cacheable by shared caches", async ({ page }) => {
  await login(page, world().users.lawyerA1);
  const res = await page.goto("/cases");
  expect(res!.headers()["cache-control"]).toMatch(/private|no-store/);
});

test("no Supabase key or service-role credential is shipped to the browser", async ({ page }) => {
  const { secret, publishable } = testEnv();
  const scripts: string[] = [];
  page.on("response", async (r) => {
    if (r.request().resourceType() === "script") scripts.push(await r.text().catch(() => ""));
  });
  await login(page, world().users.lawyerA1);
  await page.goto("/cases");
  const html = await page.content();
  const all = [html, ...scripts].join("\n");
  expect(scripts.length).toBeGreaterThan(0);
  expect(all).not.toContain(secret);
  expect(all).not.toContain(publishable); // the browser never talks to Supabase directly
  expect(all).not.toMatch(/service_role|SUPABASE_SECRET_KEY/);
  // Session cookies are HttpOnly: not readable by page scripts.
  expect(await page.evaluate(() => document.cookie)).not.toMatch(/sb-.*auth-token/);
});
