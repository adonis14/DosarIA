import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { importCases, previewCaseImport } from "@/server/dal/case-import";
import { getAuthorizedCases } from "@/server/dal/cases";
import { createLabel, deleteLabel, getLabelIdsForCases, listLabels, setCaseLabels, updateLabel } from "@/server/dal/labels";
import { addCaseNote, deleteCaseNote, listCaseNotes, updateCaseNote } from "@/server/dal/notes";
import { contextFor } from "../helpers/context";
import { adminClient, buildWorld, type World } from "../helpers/world";

/* Labels, notes and bulk import. Synthetic data only. */

let w: World;
beforeAll(async () => {
  w = await buildWorld();
});
beforeEach(() => resetRateLimits());

const caseNumberOf = async (id: string) =>
  (await adminClient().from("cases").select("court_case_number, court_name").eq("id", id).single()).data!;

describe("labels", () => {
  it("admins and lawyers create labels; every member sees them; other organizations do not", async () => {
    const lawyer = await contextFor(w.lawyerA1.client, w.orgA);
    const r = await createLabel(lawyer, { name: `Client A ${w.tag}`, color: "blue" });
    expect(r.ok).toBe(true);

    const assistant = await contextFor(w.assistantA.client, w.orgA);
    expect((await createLabel(assistant, { name: "Nu", color: "red" })).ok).toBe(false);
    expect((await listLabels(assistant, w.orgA)).map((l) => l.name)).toContain(`Client A ${w.tag}`);

    const other = await contextFor(w.lawyerB1.client, w.orgB);
    expect(await listLabels(other, w.orgA)).toEqual([]);

    // Names are unique per organization, ignoring case; colours are a fixed list.
    const dup = await createLabel(lawyer, { name: `client a ${w.tag}`, color: "red" });
    expect(dup.ok ? null : dup.code).toBe("conflict");
    expect((await createLabel(lawyer, { name: "X", color: "#ff0000" })).ok).toBe(false);
    const raw = await w.lawyerA1.client.from("case_labels").insert({ organization_id: w.orgA, name: "Y", color: "magenta" as never });
    expect(raw.error).not.toBeNull();
  });

  it("only an admin or the creator can rename or delete a label", async () => {
    const creator = await contextFor(w.lawyerA1.client, w.orgA);
    const created = await createLabel(creator, { name: `Urgent ${w.tag}`, color: "red" });
    const id = created.ok ? created.data!.id : "";

    const colleague = await contextFor(w.lawyerA2.client, w.orgA);
    expect((await updateLabel(colleague, id, { name: "Furat", color: "gray" })).ok).toBe(false);
    expect((await deleteLabel(colleague, id)).ok).toBe(false);
    // Direct API attempts are refused by RLS, too.
    const direct = await w.lawyerA2.client.from("case_labels").update({ name: "Furat" }).eq("id", id).select("id");
    expect(direct.data ?? []).toEqual([]);

    const admin = await contextFor(w.adminA.client, w.orgA);
    expect((await updateLabel(admin, id, { name: `Foarte urgent ${w.tag}`, color: "orange" })).ok).toBe(true);
    expect((await updateLabel(creator, id, { name: `Urgent ${w.tag}`, color: "red" })).ok).toBe(true);
    // Provenance cannot be rewritten.
    const forged = await w.adminA.client.from("case_labels").update({ created_by: w.adminA.id } as never).eq("id", id);
    expect(forged.error).not.toBeNull();
  });

  it("labels follow the case write rule, stay within the organization, and filter the case list", async () => {
    const lawyer = await contextFor(w.lawyerA1.client, w.orgA);
    const made = await createLabel(lawyer, { name: `Pro bono ${w.tag}`, color: "green" });
    const labelId = made.ok ? made.data!.id : "";

    expect((await setCaseLabels(lawyer, w.caseA1, { labelIds: [labelId] })).ok).toBe(true);
    expect((await getLabelIdsForCases(lawyer, [w.caseA1])).get(w.caseA1)).toEqual([labelId]);
    // Saving the same set again changes nothing.
    expect((await setCaseLabels(lawyer, w.caseA1, { labelIds: [labelId] })).ok).toBe(true);

    // Not the lawyer's case; assistants are read-only.
    expect((await setCaseLabels(lawyer, w.caseA2, { labelIds: [labelId] })).ok).toBe(false);
    const assistant = await contextFor(w.assistantA.client, w.orgA);
    expect((await setCaseLabels(assistant, w.caseA2, { labelIds: [labelId] })).ok).toBe(false);
    const assistantDirect = await w.assistantA.client
      .from("case_label_assignments")
      .insert({ organization_id: w.orgA, case_id: w.caseA2, label_id: labelId });
    expect(assistantDirect.error).not.toBeNull();

    // A label of another organization can never be attached.
    const otherAdmin = await contextFor(w.adminB.client, w.orgB);
    const foreign = await createLabel(otherAdmin, { name: `B ${w.tag}`, color: "gray" });
    const foreignId = foreign.ok ? foreign.data!.id : "";
    expect((await setCaseLabels(lawyer, w.caseA1, { labelIds: [foreignId] })).ok).toBe(false);
    const crossTenant = await w.adminB.client
      .from("case_label_assignments")
      .insert({ organization_id: w.orgB, case_id: w.caseA1, label_id: foreignId });
    expect(crossTenant.error).not.toBeNull();

    // Filter: only labelled cases.
    const admin = await contextFor(w.adminA.client, w.orgA);
    const filtered = await getAuthorizedCases(admin, { status: "all", label: labelId });
    expect(filtered.map((c) => c.id)).toEqual([w.caseA1]);
    expect(filtered[0]).not.toHaveProperty("label_filter");

    // Deleting the label removes it from every case.
    expect((await deleteLabel(lawyer, labelId)).ok).toBe(true);
    expect((await getLabelIdsForCases(admin, [w.caseA1])).get(w.caseA1)).toBeUndefined();
    const { data: audit } = await adminClient()
      .from("audit_logs")
      .select("action")
      .eq("organization_id", w.orgA)
      .in("action", ["label.created", "case.label_added", "label.deleted"]);
    expect(new Set(audit!.map((a) => a.action))).toEqual(new Set(["label.created", "case.label_added", "label.deleted"]));
  });
});

describe("notes", () => {
  const TEAM = "Clientul a trimis anexele (sintetic)";
  const PRIVATE = "Notiță privată de test — confidențial (sintetic)";

  it("team notes are visible to the case's readers; private notes only to their author", async () => {
    const lawyer = await contextFor(w.lawyerA2.client, w.orgA);
    expect((await addCaseNote(lawyer, w.caseA2, { body: TEAM })).ok).toBe(true);
    expect((await addCaseNote(lawyer, w.caseA2, { body: PRIVATE, private: "on" })).ok).toBe(true);
    expect((await listCaseNotes(lawyer, w.caseA2)).map((n) => n.body).sort()).toEqual([PRIVATE, TEAM].sort());

    for (const client of [w.adminA.client, w.assistantA.client]) {
      const ctx = await contextFor(client, w.orgA);
      expect((await listCaseNotes(ctx, w.caseA2)).map((n) => n.body)).toEqual([TEAM]);
    }
    // Cannot read the case: no notes, and cannot add one.
    const outsider = await contextFor(w.lawyerA1.client, w.orgA);
    expect(await listCaseNotes(outsider, w.caseA2)).toEqual([]);
    expect((await addCaseNote(outsider, w.caseA2, { body: "x" })).ok).toBe(false);
    const otherOrg = await w.lawyerB1.client.from("case_notes").select("id").eq("case_id", w.caseA2);
    expect(otherOrg.data ?? []).toEqual([]);
  });

  it("assistants can add notes; only the author edits or deletes; the author cannot be forged", async () => {
    const assistant = await contextFor(w.assistantA.client, w.orgA);
    expect((await addCaseNote(assistant, w.caseA2, { body: "Notă asistent (sintetic)" })).ok).toBe(true);
    const note = (await listCaseNotes(assistant, w.caseA2)).find((n) => n.author_id === w.assistantA.id)!;

    const admin = await contextFor(w.adminA.client, w.orgA);
    expect((await updateCaseNote(admin, note.id, { body: "Schimbat de admin" })).ok).toBe(false);
    expect((await deleteCaseNote(admin, note.id)).ok).toBe(false);

    const edited = await updateCaseNote(assistant, note.id, { body: "Notă asistent, corectată (sintetic)", private: "on" });
    expect(edited.ok).toBe(true);
    expect((await listCaseNotes(admin, w.caseA2)).some((n) => n.id === note.id)).toBe(false); // now private

    const forged = await w.lawyerA2.client
      .from("case_notes")
      .insert({ organization_id: w.orgA, case_id: w.caseA2, body: "falsă", author_id: w.assistantA.id });
    expect(forged.error).not.toBeNull();

    expect((await deleteCaseNote(assistant, note.id)).ok).toBe(true);
  });

  it("note text never reaches the audit log", async () => {
    const { data } = await adminClient()
      .from("audit_logs")
      .select("action, metadata")
      .eq("organization_id", w.orgA)
      .like("action", "note.%");
    expect(data!.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("sintetic");
    expect(serialized).not.toContain(PRIVATE);
  });
});

describe("bulk import", () => {
  it("preview checks every row and writes nothing; import adds the ready rows with the right owners", async () => {
    const admin = await contextFor(w.adminA.client, w.orgA, "ro");
    const existing = await caseNumberOf(w.caseA1);
    const base = Date.now() % 100000;
    const n = (i: number) => `${base + i}/3/2026`;
    const text = [
      "Număr dosar;Instanță;Titlu;Materie;Avocat",
      `${n(1)};Tribunalul București;Client import 1 (sintetic);comercial;${w.lawyerA1.email}`,
      `${n(2)};Tribunalul București;;muncă;`,
      `${existing.court_case_number};${existing.court_name};Duplicat;civil;`,
      `${n(3)};;Fără instanță;civil;`,
    ].join("\n");

    const before = (await adminClient().from("cases").select("id", { count: "exact", head: true }).eq("organization_id", w.orgA)).count;
    const preview = await previewCaseImport(admin, { data: text, defaultAssigneeId: w.lawyerA2.id });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.data!.ready).toBe(2);
    expect(preview.data!.rows.map((r) => r.ready)).toEqual([true, true, false, false]);
    expect(preview.data!.rows[1].title).toBe(`Dosar ${n(2)}`);
    expect(preview.data!.rows[2].problems).toEqual(["Este deja monitorizat în organizație."]);
    const after = (await adminClient().from("cases").select("id", { count: "exact", head: true }).eq("organization_id", w.orgA)).count;
    expect(after).toBe(before);

    const result = await importCases(admin, { data: text, defaultAssigneeId: w.lawyerA2.id });
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toEqual({ imported: 2, skipped: 2, failed: [] });
    const { data: rows } = await adminClient()
      .from("cases")
      .select("court_case_number, assigned_user_id, matter_type, created_by")
      .in("court_case_number", [n(1), n(2)])
      .order("court_case_number");
    expect(rows).toEqual([
      { court_case_number: n(1), assigned_user_id: w.lawyerA1.id, matter_type: "commercial", created_by: w.adminA.id },
      { court_case_number: n(2), assigned_user_id: w.lawyerA2.id, matter_type: "labor", created_by: w.adminA.id },
    ]);

    // Importing the same file again: everything is already there.
    const again = await importCases(admin, { data: text, defaultAssigneeId: null });
    expect(again.ok).toBe(false);
  });

  it("lawyers import only for themselves; assistants cannot import", async () => {
    const lawyer = await contextFor(w.lawyerA1.client, w.orgA);
    const num = `${(Date.now() % 100000) + 50}/3/2026`;
    const r = await importCases(lawyer, { data: `Număr dosar;Instanță;Avocat\n${num};Tribunalul Cluj;${w.lawyerA2.email}`, defaultAssigneeId: w.lawyerA2.id });
    if (!r.ok) throw new Error(r.error);
    const { data } = await adminClient().from("cases").select("assigned_user_id").eq("court_case_number", num).single();
    expect(data!.assigned_user_id).toBe(w.lawyerA1.id);

    const assistant = await contextFor(w.assistantA.client, w.orgA);
    expect((await previewCaseImport(assistant, { data: `${num};Tribunalul Cluj` })).ok).toBe(false);
  });

  it("the import function runs as the caller: RLS refuses rows the caller may not create", async () => {
    // A lawyer cannot assign to someone else, nor import into another organization.
    const num = `${(Date.now() % 100000) + 70}/3/2026`;
    const row = { court_case_number: num, court_name: "Tribunalul București", title: "Test RLS", matter_type: "civil" };
    const own = await w.lawyerA1.client.rpc("import_cases", {
      p_organization_id: w.orgA,
      p_rows: [{ ...row, assigned_user_id: w.lawyerA2.id }],
    });
    expect(own.data).toEqual([{ index: 1, error: "forbidden" }]);

    const cross = await w.lawyerB1.client.rpc("import_cases", { p_organization_id: w.orgA, p_rows: [{ ...row, assigned_user_id: w.lawyerB1.id }] });
    expect(cross.data).toEqual([{ index: 1, error: "forbidden" }]);

    const tooMany = await w.lawyerA1.client.rpc("import_cases", { p_organization_id: w.orgA, p_rows: Array.from({ length: 501 }, () => row) });
    expect(tooMany.error).not.toBeNull();
  });
});
