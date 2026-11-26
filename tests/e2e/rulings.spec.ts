import { expect, test } from "@playwright/test";
import { canonicalHash } from "../../src/server/monitoring/canonical";
import { adminClient } from "../helpers/world";
import { login, logout, world } from "./helpers";

/*
 * Ruling follow-up (Romanian default interface). A synthetic ruling dated in
 * the past is recorded on lawyer A1's case the way the monitoring process
 * does; the lawyer then records the communication date and their own deadline.
 */
test.describe.configure({ mode: "serial" });

test("lawyer records the communication date; the deadline is proposed, then confirmed", async ({ page }) => {
  const w = world();
  const now = new Date().toISOString();
  const data = { label: `e2e-ruling-${w.tag}`, hearings: [] };
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
        event_type: "decision_issued",
        event_key: canonicalHash({ e2e: w.tag, ruling: true }),
        occurred_on: "2026-11-10",
        details: { hearing_date: "2026-11-10", solution_text: "Admite cererea.", document_reference: null },
        summary_ro: "A fost pronunțată o hotărâre (sintetic, E2E).",
        summary_en: "A ruling was issued (synthetic, E2E).",
        summary_source: "deterministic_template",
        requires_review: false,
      },
    ],
  });
  expect(error).toBeNull();

  await login(page, w.users.lawyerA1);
  await expect(page.getByTestId("open-rulings")).toContainText("fără data comunicării");

  await page.getByTestId("notifications-link").click();
  await expect(page.getByTestId("my-ruling-tasks")).toContainText("1234/3/2026");
  await expect(page.getByTestId("notification").filter({ hasText: "pronunțată o hotărâre" })).toContainText(
    "Înregistrați data comunicării",
  );

  await page.goto(`/cases/${w.caseA1}`);
  const ruling = page.getByTestId("ruling");
  await expect(ruling).toHaveAttribute("data-status", "awaiting_communication");
  await expect(page.getByTestId("rulings")).toContainText("DosarIA nu calculează acest termen");

  await ruling.getByLabel("Data comunicării hotărârii").fill("2026-11-20");
  await ruling.getByLabel("Data termenului (stabilită de dvs.)").fill("2026-12-10");
  await ruling.getByLabel("Titlul termenului").fill("Termen apel (E2E)");
  await ruling.getByRole("button", { name: "Salvați data comunicării și termenul" }).click();

  await expect(ruling).toHaveAttribute("data-status", "recorded");
  await expect(ruling).toContainText("Termenul a fost adăugat ca „Propus”");
  const deadline = page.getByTestId("reminder").filter({ hasText: "Termen apel (E2E)" });
  await expect(deadline).toHaveAttribute("data-status", "proposed");
  await deadline.getByRole("button", { name: "Confirm termenul" }).click();
  await expect(deadline).toHaveAttribute("data-status", "confirmed");
  await expect(ruling).not.toContainText("Termenul a fost adăugat ca „Propus”");

  await page.getByTestId("notifications-link").click();
  await expect(page.getByTestId("my-ruling-tasks")).toHaveCount(0);
  await logout(page);
});

test("the assistant sees the ruling task but cannot resolve it", async ({ page }) => {
  const w = world();
  // Fixture: case A2 has assistant A; give it a past-dated ruling.
  const now = new Date().toISOString();
  const data = { label: `e2e-ruling-a2-${w.tag}`, hearings: [] };
  const { error } = await adminClient().rpc("record_monitoring_run", {
    p_case_id: w.caseA2,
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
        event_type: "decision_issued",
        event_key: canonicalHash({ e2e: w.tag, ruling: "a2" }),
        occurred_on: "2026-11-12",
        details: { hearing_date: "2026-11-12", solution_text: "Respinge cererea.", document_reference: null },
        summary_ro: "A fost pronunțată o hotărâre (sintetic, E2E A2).",
        summary_en: "A ruling was issued (synthetic, E2E A2).",
        summary_source: "deterministic_template",
        requires_review: false,
      },
    ],
  });
  expect(error).toBeNull();

  await login(page, w.users.assistantA);
  await page.goto(`/cases/${w.caseA2}`);
  const ruling = page.getByTestId("ruling");
  await expect(ruling).toContainText("Se așteaptă data comunicării.");
  await expect(ruling.getByRole("button")).toHaveCount(0);
  await logout(page);
});
