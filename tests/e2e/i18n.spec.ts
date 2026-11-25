import { expect, test } from "@playwright/test";
import { createConfirmedUser, TEST_PASSWORD } from "../helpers/world";
import { world } from "./helpers";

/*
 * Interface language. These tests start WITHOUT the Romanian cookie that the
 * other specs use, and use their own synthetic user and firm so a saved
 * language preference never leaks into the shared E2E users.
 */
const NO_COOKIES = { cookies: [], origins: [] };
test.use({ storageState: NO_COOKIES });

test("English is the default interface language", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByText("Access your firm's case files.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
});

test("switching language works before sign-in and is kept in a cookie", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "RO" }).click();
  await expect(page.getByRole("button", { name: "Intră în cont" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");

  await page.goto("/signup");
  await expect(page.getByRole("button", { name: "Creează contul" })).toBeVisible();

  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
});

test("English error and validation messages", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`nobody.${Date.now()}@example.com`);
  await page.getByLabel("Password", { exact: true }).fill("Wrong-Password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Incorrect email or password." })).toBeVisible();

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test");
  await page.getByLabel("Work email").fill(`weak.${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("at least 12 characters long")).toBeVisible();
});

test("English journey: firm → case → check (court terms glossed) → switch to Romanian → restored in a new browser", async ({
  page,
  browser,
}) => {
  const email = `i18n.${world().tag}.${Date.now()}@example.com`;
  await createConfirmedUser(email, "Language Test (synthetic)");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Onboarding and firm creation, in English.
  await expect(page.getByRole("heading", { name: "Welcome to DosarIA" })).toBeVisible();
  await page.getByLabel("Firm name").fill(`Language Firm ${Date.now()}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  // New case, in English.
  await page.getByRole("link", { name: "Cases", exact: true }).click();
  await page.getByRole("link", { name: "Add case" }).click();
  const caseNumber = `${Math.floor(Math.random() * 90000) + 10000}/3/2026`;
  await page.getByLabel("Case number").fill(caseNumber);
  await page.getByLabel("Court").fill("Tribunalul București");
  await page.getByLabel("Title / internal subject").fill("Claim — language E2E");
  await page.getByRole("button", { name: "Save case" }).click();
  await expect(page.getByTestId("case-number")).toHaveText(caseNumber);
  await expect(page.getByTestId("monitoring-status")).toContainText("Not checked");

  // Court name: English gloss with the Romanian original alongside.
  await expect(page.getByText("Bucharest Tribunal").first()).toBeVisible();
  await expect(page.getByText("(Tribunalul București)").first()).toBeVisible();

  // First check: English summary first, Romanian original on demand.
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("status").filter({ hasText: "New update detected" })).toBeVisible();
  const events = page.getByTestId("events");
  await expect(events).toContainText("Monitoring of this case has started.");
  await events.getByText("Original Romanian").first().click();
  await expect(events).toContainText("Monitorizarea dosarului a început");

  // Switch to Romanian: the same page re-renders in Romanian and the choice is saved.
  await page.getByRole("button", { name: "RO" }).click();
  await expect(page.getByRole("button", { name: "Verifică actualizări" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");

  // A fresh browser (no cookies) starts in English and switches to the saved language at sign-in.
  const other = await browser.newContext({ storageState: NO_COOKIES });
  const page2 = await other.newPage();
  await page2.goto("/login");
  await expect(page2.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page2.getByLabel("Email").fill(email);
  await page2.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page2.getByRole("button", { name: "Sign in" }).click();
  await expect(page2.getByRole("heading", { name: "Panou" })).toBeVisible();
  await other.close();
});
