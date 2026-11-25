import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateCaseAction } from "@/app/actions/cases";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CaseFields } from "@/components/app/case-form";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { requireOrgPageContext } from "@/server/context";
import { canEditCase, getAuthorizedCase } from "@/server/dal/cases";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.editCase };
}

export default async function EditCasePage({ params }: PageProps<"/cases/[caseId]/edit">) {
  const { caseId } = await params;
  const ctx = await requireOrgPageContext();
  const { t } = ctx;
  const c = await getAuthorizedCase(ctx, caseId);
  if (!c) notFound();

  if (!canEditCase(ctx, c)) {
    return (
      <Alert variant="destructive" className="max-w-xl" data-testid="permission-denied">
        <AlertTitle>{t.common.restrictedTitle}</AlertTitle>
        <AlertDescription>{t.editCase.denied}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <PageHeader title={t.editCase.title} description={t.editCase.description} />
      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <ActionForm action={updateCaseAction} className="grid gap-4">
            <input type="hidden" name="caseId" value={c.id} />
            <CaseFields
              withStatus
              defaults={{
                courtCaseNumber: c.court_case_number,
                courtName: c.court_name,
                title: c.title,
                matterType: c.matter_type,
                status: c.status,
              }}
            />
            <div>
              <SubmitButton pendingLabel={t.common.saving}>{t.editCase.submit}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </>
  );
}
