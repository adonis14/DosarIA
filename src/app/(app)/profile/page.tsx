import type { Metadata } from "next";
import Link from "next/link";
import { updateProfileAction } from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { LanguageSwitcher } from "@/components/app/language-switcher";
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
  const profile = await getOwnProfile(ctx);

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
    </div>
  );
}
