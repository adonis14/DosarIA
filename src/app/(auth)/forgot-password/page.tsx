import type { Metadata } from "next";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.forgotPassword };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.forgotPassword.title}</CardTitle>
        <CardDescription>{t.forgotPassword.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={forgotPasswordAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t.common.email}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
            <FieldError name="email" />
          </div>
          <SubmitButton pendingLabel={t.forgotPassword.pending}>{t.forgotPassword.submit}</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-muted-foreground underline-offset-4 hover:underline">
            {t.common.backToLogin}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
