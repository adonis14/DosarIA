import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { TEST_PASSWORD } from "../helpers/world";

export type E2EWorld = {
  tag: string;
  orgA: string;
  orgB: string;
  caseA1: string;
  caseA2: string;
  caseB1: string;
  users: Record<"adminA" | "lawyerA1" | "lawyerA2" | "assistantA" | "adminB" | "lawyerB1", string>;
};

export function world(): E2EWorld {
  return JSON.parse(readFileSync("tests/e2e/.world.json", "utf8"));
}

export async function login(page: Page, email: string, password = TEST_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Parolă", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Intră în cont" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Ieșire" }).click();
  await expect(page).toHaveURL(/\/login/);
}

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** Reads the latest email sent to `to` from the LOCAL Mailpit test inbox and returns the first app link. */
export async function latestEmailLink(to: string, pathPart: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as { messages?: { ID: string }[] };
    const id = body.messages?.[0]?.ID;
    if (id) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { HTML?: string; Text?: string };
      const html = (msg.HTML ?? msg.Text ?? "").replace(/&amp;/g, "&");
      const match = html.match(new RegExp(`https?://[^"'\\s<>]*${pathPart}[^"'\\s<>]*`));
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email with ${pathPart} for ${to}`);
}
