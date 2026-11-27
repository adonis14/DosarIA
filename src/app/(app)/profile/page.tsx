import type { Metadata } from "next";
import Link from "next/link";
import { removeMfaFactorAction } from "@/app/actions/mfa";
import { updateProfileAction } from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { MfaSetup } from "@/components/app/mfa-setup";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { listVerifiedFactors } from "@/server/mfa";
import { PageHeader } from "@/components/app/page-header";
import { RoleBadge } from "@/components/app/status-badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";
import { requirePageContext } from "@/server/context";
import { getOwnProfile } from "@/server/dal/organizations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.profile };
}

export default async function ProfilePage() {
  const ctx = await requirePageContext();
  const { t } = ctx;
  const [profile, factors] = await Promise.all([getOwnProfile(ctx), listVerifiedFactors(ctx.supabase)]);

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title={t.profile.title} description={ctx.user.email} />
      <Card>
        <CardHeader>
          <CardTitle>{t.profile.personalTitle}</CardTitle>
          <CardDescription>{t.profile.personalDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateProfileAction} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="fullName">{t.common.fullName}</Label>
              <Input id="fullName" name="fullName" defaultValue={profile?.full_name ?? ""} required />
              <FieldError name="fullName" />
            </div>
            <div>
              <SubmitButton variant="outline">{t.common.save}</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t.profile.languageTitle}</CardTitle>
          <CardDescription>{t.profile.languageDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <LanguageSwitcher />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t.profile.organizationsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {ctx.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.profile.noOrganizations}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {ctx.memberships.map((m) => (
                <li key={m.organizationId} className="flex items-center gap-2">
                  {m.organizationName} <RoleBadge role={m.role} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t.profile.securityTitle}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <Link href="/update-password" className="underline-offset-4 hover:underline">
            {t.profile.changePassword}
          </Link>
        </CardContent>
      </Card>
      <Card data-testid="mfa-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {t.mfa.title}
            <Badge variant={factors.length > 0 ? "secondary" : "outline"} data-testid="mfa-status">
              {factors.length > 0 ? t.mfa.statusOn : t.mfa.statusOff}
            </Badge>
          </CardTitle>
          <CardDescription>{t.mfa.description}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          {factors.length > 0 && (
            <div className="grid gap-3">
              <p className="font-medium">{t.mfa.devices}</p>
              <ul className="grid gap-3" data-testid="mfa-devices">
                {factors.map((f, i) => (
                  <li key={f.id} className="grid gap-2 rounded-md border p-3">
                    <span>{t.mfa.deviceAdded.replace("{n}", String(i + 1)).replace("{date}", formatDate(f.createdAt, ctx.locale))}</span>
                    <details>
                      <summary className="cursor-pointer text-xs text-muted-foreground">{t.mfa.remove}</summary>
                      <ActionForm action={removeMfaFactorAction} className="mt-2 grid gap-2">
                        <input type="hidden" name="factorId" value={f.id} />
                        <Label htmlFor={`mfa-remove-${f.id}`} className="text-xs text-muted-foreground">
                          {t.mfa.removeHint}
                        </Label>
                        <Input
                          id={`mfa-remove-${f.id}`}
                          name="code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          className="w-36 font-mono tracking-widest"
                          required
                        />
                        <FieldError name="code" />
                        <div>
                          <SubmitButton size="sm" variant="destructive">
                            {t.mfa.removeNow}
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <MfaSetup s={t.mfa} hasFactors={factors.length > 0} />
          <p className="text-xs text-muted-foreground">{t.mfa.lostDevice}</p>
        </CardContent>
      </Card>
    </div>
  );
}
