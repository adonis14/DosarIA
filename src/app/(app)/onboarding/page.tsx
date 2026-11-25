import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createOrganizationAction } from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.onboarding };
}

export default async function OnboardingPage() {
  const ctx = await requirePageContext();
  if (ctx.activeOrg) redirect("/dashboard");
  const { t } = ctx;

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title={t.onboarding.title} description={t.onboarding.description} />
      <Card>
        <CardHeader>
          <CardTitle>{t.onboarding.invitedTitle}</CardTitle>
          <CardDescription>{t.onboarding.invitedDescription}</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t.onboarding.createTitle}</CardTitle>
          <CardDescription>{t.onboarding.createDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createOrganizationAction} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="name">{t.onboarding.firmName}</Label>
              <Input id="name" name="name" placeholder={t.onboarding.firmNamePlaceholder} required />
              <FieldError name="name" />
            </div>
            <div>
              <SubmitButton>{t.onboarding.submit}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
