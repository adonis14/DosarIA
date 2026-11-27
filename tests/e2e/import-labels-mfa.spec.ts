import { expect, test } from "@playwright/test";
import { nextTotpWindow, totp } from "../helpers/totp";
import { adminClient, createConfirmedUser, TEST_PASSWORD } from "../helpers/world";
import { login, logout, world } from "./helpers";

/* Bulk import, labels, notes and two-step verification (Romanian default interface). */
test.describe.configure({ mode: "serial" });

/** Windows-1250 bytes for the Romanian letters Excel writes in a "CSV (separat prin virgulă)" file. */
function cp1250(text: string): Buffer {
  const map: Record<string, number> = { ă: 0xe3, â: 0xe2, î: 0xee, ş: 0xba, ţ: 0xfe, Ş: 0xaa, Ţ: 0xde, Ă: 0xc3 };
  return Buffer.from([...text].map((ch) => map[ch] ?? ch.charCodeAt(0)));
}

test("a lawyer imports cases from an Excel CSV: preview first, then only the valid rows", async ({ page }) => {
  const w = world();
  const base = Date.now() % 100000;
  const good = `${base}/3/2026`;
  const csv = cp1250(`Număr dosar;Instanţă;Titlu\r\n${good};Tribunalul Bucureşti;Client import E2E\r\n12-34;Tribunalul Bucureşti;Greşit\r\n`);

  await login(page, w.users.lawyerA1);
  await page.goto("/cases");
  await page.getByRole("link", { name: "Import", exact: true }).click();
  await expect(page).toHaveURL(/\/cases\/import/);
  await page.getByLabel("Fișier CSV").setInputFiles({ name: "dosare.csv", mimeType: "text/csv", buffer: csv });
  await expect(page.getByLabel("Sau lipiți celulele copiate din tabel")).toHaveValue(/Tribunalul Bucureşti/);

  await page.getByRole("button", { name: "Previzualizare" }).click();
  await expect(page.getByTestId("import-summary")).toHaveText("Gata de import: 1. Cu probleme (vor fi omise): 1.");
  const rows = page.getByTestId("import-row");
  await expect(rows.nth(1)).toContainText("Număr de dosar invalid");

  await page.getByRole("button", { name: "Importați dosarele (1)" }).click();
  await expect(page.getByTestId("import-done")).toContainText("Dosare importate: 1. Rânduri omise: 1.");

  await page.goto(`/cases?q=${encodeURIComponent(good)}`);
  await expect(page.getByTestId("cases-table")).toContainText("Client import E2E");
  await logout(page);
});

test("labels and notes: team notes are shared, private notes are not", async ({ page }) => {
  const w = world();
  const labelName = `E2E ${w.tag}`;
  await login(page, w.users.lawyerA1);
  await page.goto(`/cases/${w.caseA1}`);

  const labels = page.getByTestId("case-labels");
  await labels.getByText("Etichetă nouă").click();
  await labels.getByLabel("Denumire").fill(labelName);
  await labels.getByLabel("Culoare").selectOption("green");
  await labels.getByRole("button", { name: "Creați și adăugați la acest dosar" }).click();
  await expect(labels.getByTestId("case-labels-current")).toContainText(labelName);

  const notes = page.getByTestId("case-notes");
  await notes.getByPlaceholder(/Clientul a trimis anexele/).fill("Notă de echipă E2E (sintetic)");
  await notes.getByRole("button", { name: "Adăugați notița" }).click();
  await expect(notes.getByTestId("case-note").filter({ hasText: "Notă de echipă E2E" })).toBeVisible();
  await notes.getByPlaceholder(/Clientul a trimis anexele/).fill("Notă privată E2E (sintetic)");
  await notes.getByLabel("Doar eu (colegii nu vor vedea această notiță)").first().check();
  await notes.getByRole("button", { name: "Adăugați notița" }).click();
  const privateNote = notes.getByTestId("case-note").filter({ hasText: "Notă privată E2E" });
  await expect(privateNote.getByTestId("note-private")).toHaveText("Doar dvs.");
  await logout(page);

  // The administrator sees the team note and the label, not the private note.
  await login(page, w.users.adminA);
  await page.goto(`/cases/${w.caseA1}`);
  await expect(page.getByTestId("case-notes")).toContainText("Notă de echipă E2E");
  await expect(page.getByTestId("case-notes")).not.toContainText("Notă privată E2E");

  await page.goto("/cases?status=all");
  await page.getByLabel("Etichetă").selectOption({ label: labelName });
  await page.getByRole("button", { name: "Filtrează" }).click();
  const table = page.getByTestId("cases-table");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table).toContainText(labelName);
  await logout(page);
});

test("two-step verification: set up in the profile, then required at every sign-in", async ({ page }) => {
  test.setTimeout(150_000);
  const w = world();
  const email = `mfa-e2e.${w.tag}@example.com`;
  const userId = await createConfirmedUser(email, "Avocat MFA E2E (sintetic)");
  const { error } = await adminClient().from("organization_memberships").insert({ organization_id: w.orgA, user_id: userId, role: "lawyer" });
  expect(error).toBeNull();

  await login(page, email);
  await page.goto("/profile");
  const card = page.getByTestId("mfa-card");
  await expect(card.getByTestId("mfa-status")).toHaveText("Inactivă");
  await card.getByRole("button", { name: "Activați verificarea în doi pași" }).click();
  await expect(card.getByRole("img", { name: "Cod QR pentru aplicația de autentificare" })).toBeVisible();
  const secret = (await card.getByTestId("mfa-secret").textContent())!.trim();
  await card.getByLabel("2. Introduceți codul de 6 cifre afișat de aplicație").fill(totp(secret));
  await card.getByRole("button", { name: "Confirmați" }).click();
  await expect(card.getByTestId("mfa-enabled")).toBeVisible();
  await page.reload();
  await expect(card.getByTestId("mfa-status")).toHaveText("Activă");
  await logout(page);

  // Password alone: the code page, and no other page opens.
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Parolă", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Intră în cont" }).click();
  await expect(page).toHaveURL(/\/auth\/mfa/);
  await page.goto("/cases");
  await expect(page).toHaveURL(/\/auth\/mfa/);

  await page.getByLabel("Cod").fill("000000");
  await page.getByRole("button", { name: "Continuați" }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("Codul nu este corect");

  await nextTotpWindow(); // a new code, not the one used during set-up
  await page.getByLabel("Cod").fill(totp(secret));
  await page.getByRole("button", { name: "Continuați" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await logout(page);
});
