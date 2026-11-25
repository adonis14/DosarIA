import type { Metadata } from "next";
import { createCaseAction } from "@/app/actions/cases";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { CaseFields } from "@/components/app/case-form";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { getT } from "@/i18n/server";
import { requireOrgPageContext } from "@/server/context";
import { listMembers } from "@/server/dal/organizations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.newCase };
}

export default async function NewCasePage() {
  const ctx = await requireOrgPageContext();
  const { t } = ctx;
  const role = ctx.activeOrg.role;

  if (role === "assistant") {
    return (
      <Alert variant="destructive" className="max-w-xl" data-testid="permission-denied">
        <AlertTitle>{t.common.restrictedTitle}</AlertTitle>
        <AlertDescription>{t.newCase.assistantDenied}</AlertDescription>
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
      <PageHeader title={t.newCase.title} description={role === "admin" ? t.newCase.descriptionAdmin : t.newCase.descriptionLawyer} />
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <ActionForm action={createCaseAction} className="grid gap-4">
            <CaseFields />
            {role === "admin" && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="assignedUserId">{t.newCase.responsibleLawyer}</Label>
                  <NativeSelect id="assignedUserId" name="assignedUserId" defaultValue={ctx.user.id}>
                    <NativeSelectOption value="">{t.common.unassignedOption}</NativeSelectOption>
                    {lawyers.map((m) => (
                      <NativeSelectOption key={m.user_id} value={m.user_id}>
                        {nameOf(m)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldError name="assignedUserId" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="assignedAssistantId">{t.newCase.assistantOptional}</Label>
                  <NativeSelect id="assignedAssistantId" name="assignedAssistantId" defaultValue="">
                    <NativeSelectOption value="">{t.common.noneOption}</NativeSelectOption>
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
              <SubmitButton pendingLabel={t.common.saving}>{t.newCase.submit}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
