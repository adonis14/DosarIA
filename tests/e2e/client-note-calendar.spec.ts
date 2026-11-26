import { expect, test } from "@playwright/test";
import { canonicalHash } from "../../src/server/monitoring/canonical";
import { adminClient } from "../helpers/world";
import { login, logout, world } from "./helpers";

/* Client note drafts and the private calendar link (Romanian default interface). */
test.describe.configure({ mode: "serial" });

test("a court update offers an editable client note with the court's exact wording", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = world();
  const now = new Date().toISOString();
  const data = { label: `e2e-note-${w.tag}`, hearings: [] };
  const { error } = await adminClient().rpc("record_monitoring_run", {
    p_case_id: w.caseA1,
    p_organization_id: w.orgA,
    p_triggered_by: null as unknown as string,
    p_trigger_type: "scheduled",
    p_provider: "mock",
    p_started_at: now,
    p_finished_at: now,
    p_outcome: "changes_detected",
    p_snapshot: { source_reference: "mock://e2e", fetched_at: now, completeness: "complete", content_hash: canonicalHash(data), data },
    p_events: [
      {
        event_type: "hearing_postponed",
        event_key: canonicalHash({ e2e: w.tag, note: true }),
        occurred_on: "2027-01-09",
        details: { previous_date: "2026-12-12", new_date: "2027-01-09", solution_text: "Amână cauza pentru lipsă de procedură" },
        summary_ro: "Judecata a fost amânată (sintetic, E2E).",
        summary_en: "The hearing was adjourned (synthetic, E2E).",
        summary_source: "deterministic_template",
        requires_review: false,
      },
    ],
  });
  expect(error).toBeNull();

  await login(page, w.users.lawyerA1);
  await page.goto(`/cases/${w.caseA1}`);
  const event = page.getByTestId("events").locator("li").filter({ hasText: "Judecata a fost amânată (sintetic, E2E)." });
  const note = event.getByTestId("client-note");
  await note.getByText("Notă pentru client (ciornă)").click();
  const ro = note.getByLabel("În română");
  await expect(ro).toHaveValue(/^Bună ziua,/);
  await expect(ro).toHaveValue(/„Amână cauza pentru lipsă de procedură”/);
  await expect(ro).toHaveValue(/Următorul termen de judecată este 09 ianuarie 2027\./);
  await expect(note.getByLabel("În engleză")).toHaveValue(/The next hearing is on 09 January 2027\./);

  await ro.fill("Bună ziua,\n\nText editat de avocat.");
  await note.getByRole("button", { name: "Copiați" }).first().click();
  await expect(note.getByRole("button", { name: "Copiat" })).toBeVisible();
  // Windows clipboards return CRLF line endings.
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, "\n")).toBe("Bună ziua,\n\nText editat de avocat.");
  await logout(page);
});

test("the calendar link is shown once, serves a calendar, and stops working when turned off", async ({ page }) => {
  const w = world();
  await login(page, w.users.lawyerA2);
  await page.goto("/notifications");
  const card = page.getByTestId("calendar-card");
  await card.getByRole("button", { name: "Creați linkul de calendar" }).click();
  const url = await page.getByTestId("calendar-link").getByRole("textbox").inputValue();
  expect(url).toMatch(/\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);

  // Calendar apps fetch it without signing in.
  const feed = await page.request.get(url, { headers: { cookie: "" } });
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toBe("text/calendar; charset=utf-8");
  expect(await feed.text()).toContain("BEGIN:VCALENDAR");

  await page.reload();
  await expect(page.getByTestId("calendar-status")).toContainText("Activ din");
  await expect(page.getByTestId("calendar-link")).toHaveCount(0); // never shown again
  await card.getByRole("button", { name: "Dezactivați linkul" }).click();
  await expect(page.getByTestId("calendar-status")).toHaveCount(0);
  expect((await page.request.get(url)).status()).toBe(404);
  await logout(page);
});
