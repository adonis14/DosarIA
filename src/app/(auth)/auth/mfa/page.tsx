import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { logoutAction, mfaSignInAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";
import { safeNextPath } from "@/lib/security/redirects";
import { getAuthContext, getMfaPendingSession } from "@/server/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.mfa };
}

/** Second sign-in step, for accounts with two-step verification turned on. */
export default async function MfaPage({ searchParams }: PageProps<"/auth/mfa">) {
  const t = await getT();
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null);
  if (!(await getMfaPendingSession())) redirect((await getAuthContext()) ? next : "/login");

  return (
    <Card>
      <CardHeader>
        <ShieldCheck className="size-6 text-muted-foreground" aria-hidden />
        <CardTitle>{t.mfa.verifyTitle}</CardTitle>
        <CardDescription>{t.mfa.verifyDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ActionForm action={mfaSignInAction} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="grid gap-2">
            <Label htmlFor="code">{t.mfa.code}</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
              required
              className="font-mono text-lg tracking-widest"
            />
            <FieldError name="code" />
          </div>
          <SubmitButton>{t.mfa.verifySubmit}</SubmitButton>
        </ActionForm>
        <form action={logoutAction}>
          <Button type="submit" variant="ghost" size="sm" className="w-full">
            {t.mfa.signOut}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t.mfa.lostDevice}</p>
      </CardContent>
    </Card>
  );
}
