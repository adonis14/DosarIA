import { expect, test } from "@playwright/test";
import { login, logout, world } from "./helpers";

test.describe.configure({ mode: "serial" });

test("lawyer workflow: add case → check for updates → summaries → reminder → confirm", async ({ page }) => {
  const w = world();
  await login(page, w.users.lawyerA1);

  // Add a case (assigned automatically to the lawyer).
  const caseNumber = `${Math.floor(Math.random() * 90000) + 10000}/3/2026`;
  await page.getByRole("link", { name: "Dosare", exact: true }).click();
  await page.getByRole("link", { name: "Adaugă dosar" }).click();
  await page.getByLabel("Număr dosar").fill(caseNumber);
  await page.getByLabel("Instanța").fill("Tribunalul București");
  await page.getByLabel("Titlu / obiect intern").fill("Pretenții — test E2E");
  await page.getByRole("button", { name: "Salvează dosarul" }).click();
  await expect(page.getByTestId("case-number")).toHaveText(caseNumber);
  await expect(page.getByTestId("monitoring-status")).toContainText("Neverificat");

  const check = async () => {
    await page.getByRole("button", { name: "Verifică actualizări" }).click();
    await expect(page.getByRole("button", { name: "Verifică actualizări" })).toBeEnabled({ timeout: 20_000 });
    await page.waitForTimeout(5_200); // per-case rate limit window
  };

  // 1st check: baseline.
  await check();
  await expect(page.getByTestId("events")).toContainText("Monitorizarea dosarului a început");
  await expect(page.getByTestId("monitoring-status")).toContainText("Actualizare nouă detectată");

  // 2nd check: no changes.
  await check();
  await expect(page.getByRole("status").filter({ hasText: "Nicio modificare" })).toBeVisible();

  // 3rd check: hearing rescheduled.
  await check();
  await expect(page.getByTestId("events")).toContainText("Termenul de judecată a fost reprogramat");

  // 4th check: source unavailable — reported as a failure, previous data kept.
  const lastSuccess = await page.getByTestId("last-successful-check").textContent();
  await page.getByRole("button", { name: "Verifică actualizări" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Sursă indisponibilă" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("monitoring-status")).toContainText("Sursă indisponibilă");
  await expect(page.getByTestId("last-successful-check")).toHaveText(lastSuccess!);

  // Suggested reminders are clearly marked and not confirmed.
  const reminders = page.getByTestId("reminders");
  await expect(reminders).toContainText("Sugerat din sursă");
  await expect(reminders).toContainText("Necesită verificare");

  // Manual reminder → confirm.
  await page.getByText("Adaugă un termen sau memento").click();
  await page.getByLabel("Titlu", { exact: true }).fill("Depunere note scrise");
  await page.getByLabel("Data").fill("2026-12-15");
  await page.getByRole("button", { name: /Adaugă \(statut/ }).click();
  const manual = page.getByTestId("reminder").filter({ hasText: "Depunere note scrise" });
  await expect(manual).toContainText("Introdus manual");
  await expect(manual).toContainText("Propus");
  await manual.getByRole("button", { name: "Confirm termenul" }).click();
  await expect(manual).toHaveAttribute("data-status", "confirmed");
  await expect(manual).toContainText("Confirmat de");

  await page.getByRole("link", { name: "Panou", exact: true }).click();
  await expect(page.getByTestId("upcoming-reminders")).toContainText("Depunere note scrise");
});

test("ID manipulation through the UI: other lawyer's and other firm's cases are not found", async ({ page }) => {
  const w = world();
  await login(page, w.users.lawyerA1);
  for (const id of [w.caseA2, w.caseB1]) {
    await page.goto(`/cases/${id}`);
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.getByText("Ordonanță de plată (A2)")).toHaveCount(0);
    await expect(page.getByText("Contestație la executare (B1)")).toHaveCount(0);
    await page.goto(`/cases/${id}/edit`);
    await expect(page.getByTestId("not-found")).toBeVisible();
  }
  await page.goto("/cases");
  await expect(page.getByTestId("cases-table")).not.toContainText("5678/299/2026");
  await expect(page.getByTestId("cases-table")).not.toContainText("910/117/2026");
  await logout(page);
});

test("admin sees all organization cases, members and the audit trail; a lawyer does not", async ({ page }) => {
  const w = world();
  await login(page, w.users.adminA);
  await page.goto("/cases");
  await expect(page.getByTestId("cases-table")).toContainText("5678/299/2026");
  await expect(page.getByTestId("cases-table")).not.toContainText("910/117/2026");
  await page.goto("/settings");
  await expect(page.getByTestId("members-table")).toContainText(w.users.lawyerA2);
  await expect(page.getByTestId("audit-table")).toContainText("Dosar creat");
  await expect(page.getByTestId("members-table")).not.toContainText(w.users.lawyerB1);
  await logout(page);

  await login(page, w.users.lawyerA1);
  await page.goto("/settings");
  await expect(page.getByTestId("audit-table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Creează invitația" })).toHaveCount(0);
});

test("assistant has read-only access to the assigned case", async ({ page }) => {
  const w = world();
  await login(page, w.users.assistantA);
  await page.goto(`/cases/${w.caseA2}`);
  await expect(page.getByTestId("case-number")).toHaveText("5678/299/2026");
  await expect(page.getByRole("link", { name: "Editează" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Confirm termenul" })).toHaveCount(0);
  await page.goto(`/cases/${w.caseA2}/edit`);
  await expect(page.getByTestId("permission-denied")).toBeVisible();
  await page.goto("/cases/new");
  await expect(page.getByTestId("permission-denied")).toBeVisible();
});
