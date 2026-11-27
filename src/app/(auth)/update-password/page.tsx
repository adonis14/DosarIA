import type { Metadata } from "next";
import { updatePasswordAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";
import { redirect } from "next/navigation";
import { getMfaPendingSession, requirePageContext } from "@/server/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.updatePassword };
}

export default async function UpdatePasswordPage() {
  // Two-step users (e.g. arriving from a reset link) enter their code first, then come back here.
  if (await getMfaPendingSession()) redirect("/auth/mfa?next=/update-password");
  const { t } = await requirePageContext();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.updatePassword.title}</CardTitle>
        <CardDescription>{t.updatePassword.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={updatePasswordAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="password">{t.updatePassword.newPassword}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
            <FieldError name="password" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">{t.updatePassword.confirmPassword}</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            <FieldError name="confirmPassword" />
          </div>
          <SubmitButton pendingLabel={t.common.saving}>{t.updatePassword.submit}</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
