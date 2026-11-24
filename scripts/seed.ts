/**
 * Seeds a LOCAL Supabase instance with SYNTHETIC demo data:
 *
 *   București Legal Partners: admin.a, avocat.a1, avocat.a2, asistent.a
 *   Cluj Legal Group:         admin.b, avocat.b1
 *
 * Usage: npm run seed            (password from DEMO_PASSWORD or generated)
 * Refuses to run against anything but a local Supabase URL.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { testEnv } from "../tests/helpers/env";

const env = testEnv(); // throws unless SUPABASE_URL is localhost
const admin = createClient<Database>(env.url, env.secret, { auth: { persistSession: false } });
const password = process.env.DEMO_PASSWORD ?? `Demo-${randomBytes(6).toString("base64url")}-2026`;
const DOMAIN = "example.com";

type Seed = { key: string; email: string; name: string };
const people: Seed[] = [
  { key: "adminA", email: `admin.a@bucuresti-legal.${DOMAIN}`, name: "Ana Administrator (sintetic)" },
  { key: "lawyerA1", email: `avocat.a1@bucuresti-legal.${DOMAIN}`, name: "Andrei Avocat (sintetic)" },
  { key: "lawyerA2", email: `avocat.a2@bucuresti-legal.${DOMAIN}`, name: "Alina Avocat (sintetic)" },
  { key: "assistantA", email: `asistent.a@bucuresti-legal.${DOMAIN}`, name: "Alex Asistent (sintetic)" },
  { key: "adminB", email: `admin.b@cluj-legal.${DOMAIN}`, name: "Bogdan Administrator (sintetic)" },
  { key: "lawyerB1", email: `avocat.b1@cluj-legal.${DOMAIN}`, name: "Bianca Avocat (sintetic)" },
];

async function userClient(email: string) {
  const c = createClient<Database>(env.url, env.publishable, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function main() {
  const { data: existing } = await admin.from("profiles").select("id").eq("email", people[0].email).maybeSingle();
  if (existing) {
    console.log("Demo data already present. To start over: npx supabase db reset && npm run seed");
    return;
  }

  const ids: Record<string, string> = {};
  for (const p of people) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: p.name },
    });
    if (error) throw new Error(`createUser ${p.email}: ${error.message}`);
    ids[p.key] = data.user.id;
  }

  const adminA = await userClient(people[0].email);
  const adminB = await userClient(people[4].email);
  const { data: orgA } = await adminA.rpc("create_organization", { p_name: "București Legal Partners" });
  const { data: orgB } = await adminB.rpc("create_organization", { p_name: "Cluj Legal Group" });

  // Equivalent to accepted invitations.
  await admin.from("organization_memberships").insert([
    { organization_id: orgA!, user_id: ids.lawyerA1, role: "lawyer" },
    { organization_id: orgA!, user_id: ids.lawyerA2, role: "lawyer" },
    { organization_id: orgA!, user_id: ids.assistantA, role: "assistant" },
    { organization_id: orgB!, user_id: ids.lawyerB1, role: "lawyer" },
  ]);

  const cases = [
    { org: orgA!, by: adminA, number: "1234/3/2026", court: "Tribunalul București", title: "Pretenții — contract de furnizare", type: "commercial", lawyer: ids.lawyerA1, assistant: ids.assistantA },
    { org: orgA!, by: adminA, number: "2468/299/2026", court: "Judecătoria Sectorului 1 București", title: "Ordonanță de plată — facturi neachitate", type: "civil", lawyer: ids.lawyerA1, assistant: null },
    { org: orgA!, by: adminA, number: "5678/3/2026", court: "Tribunalul București", title: "Litigiu de muncă — contestație decizie", type: "labor", lawyer: ids.lawyerA2, assistant: null },
    { org: orgA!, by: adminA, number: "9999/3/2026", court: "Tribunalul București", title: "Demo: sursă indisponibilă", type: "other", lawyer: ids.lawyerA2, assistant: null },
    { org: orgB!, by: adminB, number: "910/117/2026", court: "Tribunalul Cluj", title: "Contestație la executare", type: "enforcement", lawyer: ids.lawyerB1, assistant: null },
    { org: orgB!, by: adminB, number: "1357/211/2026", court: "Judecătoria Cluj-Napoca", title: "Acțiune în anulare", type: "civil", lawyer: ids.lawyerB1, assistant: null },
  ] as const;

  for (const c of cases) {
    const { error } = await c.by.from("cases").insert({
      organization_id: c.org,
      court_case_number: c.number,
      court_name: c.court,
      title: c.title,
      matter_type: c.type,
      assigned_user_id: c.lawyer,
      assigned_assistant_id: c.assistant,
      created_by: c.by === adminA ? ids.adminA : ids.adminB,
    });
    if (error) throw new Error(`case ${c.number}: ${error.message}`);
  }

  console.log("\nSynthetic demo data created (LOCAL ONLY).");
  console.log(`Password for all demo users: ${password}\n`);
  for (const p of people) console.log(`  ${p.key.padEnd(11)} ${p.email}`);
  console.log("\nOpen http://localhost:3000 and sign in. Use 'Verifică actualizări' on a case to simulate court updates.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
