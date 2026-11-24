import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import { canonicalHash } from "../../src/server/monitoring/canonical";
import { testEnv } from "./env";

/**
 * Synthetic multi-tenant fixture ("world") built through the SAME paths real
 * users take wherever possible: organizations via the create_organization RPC
 * as the signed-in founder, cases and reminders via user-scoped clients.
 * The privileged client is used only where the product itself uses a
 * privileged path (accepted invitations → memberships, monitoring results).
 */

export type Db = SupabaseClient<Database>;

/** Synthetic, local-only test password. Never used outside local development. */
export const TEST_PASSWORD = "Dosaria-Local-Test-2026";

export function adminClient(): Db {
  const env = testEnv();
  return createClient<Database>(env.url, env.secret, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function anonClient(): Db {
  const env = testEnv();
  return createClient<Database>(env.url, env.publishable, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function createConfirmedUser(email: string, fullName: string, password = TEST_PASSWORD): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`createUser(${email}) failed: ${error?.message}`);
  return data.user.id;
}

export async function signIn(email: string, password = TEST_PASSWORD): Promise<Db> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
  return client;
}

type Person = { id: string; email: string; client: Db };

export type World = {
  tag: string;
  orgA: string;
  orgB: string;
  adminA: Person;
  lawyerA1: Person;
  lawyerA2: Person;
  assistantA: Person;
  adminB: Person;
  lawyerB1: Person;
  caseA1: string; // lawyerA1's case
  caseA2: string; // lawyerA2's case (assistantA assigned)
  caseB1: string; // lawyerB1's case in org B
  eventA1: string;
  eventA2: string;
  eventB1: string;
  reminderA1: string;
  reminderB1: string;
  membershipA1: string;
};

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`fixture: ${what} missing`);
  return value;
}

async function person(email: string, name: string): Promise<Person> {
  const id = await createConfirmedUser(email, name);
  return { id, email, client: await signIn(email) };
}

export async function recordSyntheticRun(caseId: string, organizationId: string, triggeredBy: string, label: string) {
  const admin = adminClient();
  const data = { label, hearings: [] };
  const { data: result, error } = await admin.rpc("record_monitoring_run", {
    p_case_id: caseId,
    p_organization_id: organizationId,
    p_triggered_by: triggeredBy,
    p_trigger_type: "manual",
    p_provider: "mock",
    p_started_at: new Date().toISOString(),
    p_finished_at: new Date().toISOString(),
    p_outcome: "changes_detected",
    p_court_status: "În curs de judecată",
    p_snapshot: {
      source_reference: "mock://fixture",
      fetched_at: new Date().toISOString(),
      completeness: "complete",
      content_hash: canonicalHash(data),
      data,
    },
    p_events: [
      {
        event_type: "monitoring_started",
        event_key: canonicalHash({ type: "monitoring_started", label }),
        occurred_on: null,
        details: { status: "În curs de judecată", stage: "Fond", next_hearing_date: null },
        summary_ro: `Monitorizarea dosarului a început (${label}).`,
        summary_en: `Monitoring started (${label}).`,
        summary_source: "deterministic_template",
        requires_review: false,
      },
    ],
  });
  if (error) throw new Error(`record_monitoring_run failed: ${error.message}`);
  const { data: ev } = await admin.from("case_events").select("id").eq("case_id", caseId).order("detected_at").limit(1).single();
  return { result, eventId: must(ev?.id, "event id") };
}

export async function buildWorld(tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`): Promise<World> {
  const admin = adminClient();
  const mail = (who: string) => `${who}.${tag}@example.com`;

  const [adminA, lawyerA1, lawyerA2, assistantA, adminB, lawyerB1] = await Promise.all([
    person(mail("admin-a"), "Admin A (sintetic)"),
    person(mail("lawyer-a1"), "Avocat A1 (sintetic)"),
    person(mail("lawyer-a2"), "Avocat A2 (sintetic)"),
    person(mail("assistant-a"), "Asistent A (sintetic)"),
    person(mail("admin-b"), "Admin B (sintetic)"),
    person(mail("lawyer-b1"), "Avocat B1 (sintetic)"),
  ]);

  // Organizations are founded through the user-facing RPC.
  const { data: orgA, error: eA } = await adminA.client.rpc("create_organization", { p_name: `București Legal Partners ${tag}` });
  const { data: orgB, error: eB } = await adminB.client.rpc("create_organization", { p_name: `Cluj Legal Group ${tag}` });
  if (eA || eB) throw new Error(`create_organization failed: ${eA?.message ?? eB?.message}`);

  // Equivalent of accepted invitations (privileged path).
  const { data: ms, error: mErr } = await admin
    .from("organization_memberships")
    .insert([
      { organization_id: orgA!, user_id: lawyerA1.id, role: "lawyer" },
      { organization_id: orgA!, user_id: lawyerA2.id, role: "lawyer" },
      { organization_id: orgA!, user_id: assistantA.id, role: "assistant" },
      { organization_id: orgB!, user_id: lawyerB1.id, role: "lawyer" },
    ])
    .select("id, user_id");
  if (mErr) throw new Error(`memberships failed: ${mErr.message}`);

  const insertCase = async (client: Db, row: Database["public"]["Tables"]["cases"]["Insert"]) => {
    const { data, error } = await client.from("cases").insert(row).select("id").single();
    if (error) throw new Error(`case insert failed: ${error.message}`);
    return data.id;
  };

  const caseA1 = await insertCase(lawyerA1.client, {
    organization_id: orgA!,
    court_case_number: "1234/3/2026",
    court_name: "Tribunalul București",
    title: "Pretenții — contract de furnizare (A1)",
    matter_type: "commercial",
    assigned_user_id: lawyerA1.id,
    created_by: lawyerA1.id,
  });
  const caseA2 = await insertCase(adminA.client, {
    organization_id: orgA!,
    court_case_number: "5678/299/2026",
    court_name: "Judecătoria Sectorului 1 București",
    title: "Ordonanță de plată (A2)",
    matter_type: "civil",
    assigned_user_id: lawyerA2.id,
    assigned_assistant_id: assistantA.id,
    created_by: adminA.id,
  });
  const caseB1 = await insertCase(adminB.client, {
    organization_id: orgB!,
    court_case_number: "910/117/2026",
    court_name: "Tribunalul Cluj",
    title: "Contestație la executare (B1)",
    matter_type: "enforcement",
    assigned_user_id: lawyerB1.id,
    created_by: adminB.id,
  });

  const [{ eventId: eventA1 }, { eventId: eventA2 }, { eventId: eventB1 }] = await Promise.all([
    recordSyntheticRun(caseA1, orgA!, lawyerA1.id, "A1"),
    recordSyntheticRun(caseA2, orgA!, lawyerA2.id, "A2"),
    recordSyntheticRun(caseB1, orgB!, lawyerB1.id, "B1"),
  ]);

  const insertReminder = async (client: Db, organizationId: string, caseId: string, by: string) => {
    const { data, error } = await client
      .from("deadline_reminders")
      .insert({ organization_id: organizationId, case_id: caseId, title: "Depunere întâmpinare", due_date: "2026-12-20", created_by: by })
      .select("id")
      .single();
    if (error) throw new Error(`reminder insert failed: ${error.message}`);
    return data.id;
  };
  const reminderA1 = await insertReminder(lawyerA1.client, orgA!, caseA1, lawyerA1.id);
  const reminderB1 = await insertReminder(lawyerB1.client, orgB!, caseB1, lawyerB1.id);

  return {
    tag,
    orgA: orgA!,
    orgB: orgB!,
    adminA,
    lawyerA1,
    lawyerA2,
    assistantA,
    adminB,
    lawyerB1,
    caseA1,
    caseA2,
    caseB1,
    eventA1,
    eventA2,
    eventB1,
    reminderA1,
    reminderB1,
    membershipA1: must(ms?.find((m) => m.user_id === lawyerA1.id)?.id, "membership A1"),
  };
}
