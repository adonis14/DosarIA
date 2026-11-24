import { expect, test } from "@playwright/test";
import { latestEmailLink, login, logout, world } from "./helpers";

test.describe.configure({ mode: "serial" });

const email = `signup.${Date.now().toString(36)}@example.com`;
const password = "Semnare-Noua-2026";

test("sign-up requires email verification before login", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nume complet").fill("Avocat Nou (sintetic)");
  await page.getByLabel("E-mail profesional").fill(email);
  await page.getByLabel("Parolă").fill(password);
  await page.getByRole("button", { name: "Creează contul" }).click();
  await expect(page).toHaveURL(/\/auth\/check-email/);

  // Login before verification is refused.
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Parolă", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Intră în cont" }).click();
  // (Next.js also renders an empty role="alert" route announcer, hence the filter.)
  await expect(page.getByRole("alert").filter({ hasText: "nu a fost confirmată" })).toBeVisible();

  // Follow the confirmation link from the local test inbox (Mailpit).
  const link = await latestEmailLink(email, "/auth/confirm");
  await page.goto(link);
  await expect(page).toHaveURL(/\/onboarding/);

  // A verified user can found an organization and becomes its admin.
  await page.getByLabel("Denumirea cabinetului").fill(`Cabinet E2E ${Date.now()}`);
  await page.getByRole("button", { name: "Creează organizația" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("Administrator").first()).toBeVisible();
  await logout(page);
});

test("weak passwords are rejected", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Nume complet").fill("Test");
  await page.getByLabel("E-mail profesional").fill(`weak.${Date.now()}@example.com`);
  await page.getByLabel("Parolă").fill("short");
  await page.getByRole("button", { name: "Creează contul" }).click();
  await expect(page.getByText("cel puțin 12 caractere")).toBeVisible();
});

test("password reset via emailed one-time link", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Trimite linkul de resetare" }).click();
  await expect(page.getByRole("status")).toContainText("Dacă adresa există");

  const link = await latestEmailLink(email, "type=recovery");
  await page.goto(link);
  await expect(page).toHaveURL(/\/update-password/);
  await page.getByLabel("Parolă nouă").fill("Parola-Resetata-2026");
  await page.getByLabel("Confirmați parola").fill("Parola-Resetata-2026");
  await page.getByRole("button", { name: "Salvează parola" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await logout(page);

  await login(page, email, "Parola-Resetata-2026");
  // The used link cannot be replayed.
  await logout(page);
  await page.goto(link);
  await expect(page).toHaveURL(/\/auth\/error/);
});

test("logout ends the session", async ({ page }) => {
  await login(page, world().users.lawyerB1);
  await logout(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
