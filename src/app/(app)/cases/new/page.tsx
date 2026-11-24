import { createCaseAction } from "@/app/actions/cases";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { CaseFields } from "@/components/app/case-form";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requireOrgPageContext } from "@/server/context";
import { listMembers } from "@/server/dal/organizations";

export const metadata = { title: "Dosar nou" };

export default async function NewCasePage() {
  const ctx = await requireOrgPageContext();
  const role = ctx.activeOrg.role;

  if (role === "assistant") {
    return (
      <Alert variant="destructive" className="max-w-xl" data-testid="permission-denied">
        <AlertTitle>Acces restricționat</AlertTitle>
        <AlertDescription>Asistenții nu pot adăuga dosare. Contactați un avocat sau un administrator.</AlertDescription>
      </Alert>
    );
  }

  const members = role === "admin" ? await listMembers(ctx, ctx.activeOrg.organizationId) : [];
  const active = members.filter((m) => m.status === "active");
  const lawyers = active.filter((m) => m.role !== "assistant");
  const assistants = active.filter((m) => m.role === "assistant");
  const nameOf = (m: (typeof members)[number]) => m.profiles?.full_name || m.profiles?.email || m.user_id;

  return (
    <>
      <PageHeader
        title="Dosar nou"
        description={
          role === "admin"
            ? "Dosarul va fi monitorizat în organizația activă."
            : "Dosarul va fi alocat automat dumneavoastră. Alocarea altor persoane se face de un administrator."
        }
      />
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <ActionForm action={createCaseAction} className="grid gap-4">
            <CaseFields />
            {role === "admin" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="assignedUserId">Avocat responsabil</Label>
                  <NativeSelect id="assignedUserId" name="assignedUserId" defaultValue={ctx.user.id}>
                    <NativeSelectOption value="">— Nealocat —</NativeSelectOption>
                    {lawyers.map((m) => (
                      <NativeSelectOption key={m.user_id} value={m.user_id}>
                        {nameOf(m)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError name="assignedUserId" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="assignedAssistantId">Asistent (opțional)</Label>
                  <NativeSelect id="assignedAssistantId" name="assignedAssistantId" defaultValue="">
                    <NativeSelectOption value="">— Niciunul —</NativeSelectOption>
                    {assistants.map((m) => (
                      <NativeSelectOption key={m.user_id} value={m.user_id}>
                        {nameOf(m)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              </>
            )}
            <div>
              <SubmitButton pendingLabel="Se salvează…">Salvează dosarul</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
