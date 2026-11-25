import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";
import { safeNextPath } from "@/lib/security/redirects";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.login };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getT();
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.login.title}</CardTitle>
        <CardDescription>{t.login.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={loginAction} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="grid gap-2">
            <Label htmlFor="email">{t.common.email}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">{t.common.password}</Label>
              <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                {t.login.forgot}
              </Link>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <SubmitButton pendingLabel={t.login.pending}>{t.login.submit}</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {t.login.noAccount}{" "}
          <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            {t.login.createAccount}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
