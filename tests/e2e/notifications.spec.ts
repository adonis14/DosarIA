import { expect, test } from "@playwright/test";
import { login, logout, world } from "./helpers";

/*
 * Per-person notifications (Romanian default interface).
 * Fixture: case A2 belongs to lawyer A2 with assistant A; its first court
 * event was recorded when the synthetic world was built.
 */
test.describe.configure({ mode: "serial" });

test("the assistant sees the case's alert, marks it read, and the badge clears", async ({ page }) => {
  const w = world();
  await login(page, w.users.assistantA);

  const link = page.getByTestId("notifications-link");
  await expect(link).toContainText("Notificări");
  await expect(page.getByTestId("unread-count")).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/notifications/);

  const item = page.getByTestId("notification").filter({ hasText: "5678/299/2026" });
  await expect(item).toHaveAttribute("data-unread", "true");
  await expect(item).toContainText("Actualizare de la instanță");
  await expect(item).toContainText("Monitorizarea dosarului a început");

  await page.getByRole("button", { name: "Marcați toate ca citite" }).click();
  await expect(item).toHaveAttribute("data-unread", "false");
  await expect(page.getByTestId("unread-count")).toHaveCount(0);
  await logout(page);
});

test("a colleague's case sends no alerts; the admin sees nothing until they follow it", async ({ page }) => {
  const w = world();
  await login(page, w.users.adminA);
  await page.getByTestId("notifications-link").click();
  await expect(page.getByTestId("notification").filter({ hasText: "5678/299/2026" })).toHaveCount(0);

  await page.goto(`/cases/${w.caseA2}`);
  const alerts = page.getByTestId("case-alerts");
  await expect(alerts).toContainText("Nu primiți alerte pentru acest dosar.");
  await alerts.getByRole("button", { name: "Urmăriți dosarul" }).click();
  await expect(alerts).toContainText("Urmăriți acest dosar și primiți alertele lui.");
  await alerts.getByRole("button", { name: "Nu mai urmăriți" }).click();
  await expect(alerts).toContainText("Nu primiți alerte pentru acest dosar.");
  await logout(page);
});

test("the assigned lawyer is told why they get alerts and can change their own settings", async ({ page }) => {
  const w = world();
  await login(page, w.users.lawyerA2);
  await page.goto(`/cases/${w.caseA2}`);
  await expect(page.getByTestId("case-alerts")).toContainText("Primiți alerte pentru acest dosar deoarece vă este atribuit.");
  await expect(page.getByTestId("case-alerts").getByRole("button")).toHaveCount(0);

  await page.goto("/notifications");
  const courtUpdates = page.getByLabel("Actualizări noi de la instanță în dosarele mele");
  await expect(courtUpdates).toBeChecked();
  await courtUpdates.uncheck();
  await page.getByRole("button", { name: "Salvați setările" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Setările de alertă au fost salvate." })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Actualizări noi de la instanță în dosarele mele")).not.toBeChecked();
  await expect(page.getByText("Alertele de termen și atribuirile noi sunt întotdeauna active.")).toBeVisible();

  // Restore the default for other runs.
  await page.getByLabel("Actualizări noi de la instanță în dosarele mele").check();
  await page.getByRole("button", { name: "Salvați setările" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Setările de alertă au fost salvate." })).toBeVisible();
  await logout(page);
});
