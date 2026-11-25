import type { Metadata } from "next";
import Link from "next/link";
import { signupAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.signup };
}

export default async function SignupPage() {
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.signup.title}</CardTitle>
        <CardDescription>{t.signup.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={signupAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="fullName">{t.common.fullName}</Label>
            <Input id="fullName" name="fullName" autoComplete="name" required />
            <FieldError name="fullName" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">{t.signup.workEmail}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
            <FieldError name="email" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t.common.password}</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
            <p className="text-xs text-muted-foreground">{t.signup.passwordHint}</p>
            <FieldError name="password" />
          </div>
          <SubmitButton pendingLabel={t.signup.pending}>{t.signup.submit}</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t.signup.haveAccount}{" "}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t.common.signIn}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
