import Link from "next/link";
import { updateProfileAction } from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { PageHeader } from "@/components/app/page-header";
import { RoleBadge } from "@/components/app/status-badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePageContext } from "@/server/context";
import { getOwnProfile } from "@/server/dal/organizations";

export const metadata = { title: "Profil" };

export default async function ProfilePage() {
  const ctx = await requirePageContext();
  const profile = await getOwnProfile(ctx);

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Profil" description={ctx.user.email} />
      <Card>
        <CardHeader>
          <CardTitle>Date personale</CardTitle>
          <CardDescription>Adresa de e-mail se modifică doar prin fluxul de confirmare al contului.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateProfileAction} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="fullName">Nume complet</Label>
              <Input id="fullName" name="fullName" defaultValue={profile?.full_name ?? ""} required />
              <FieldError name="fullName" />
            </div>
            <div>
              <SubmitButton variant="outline">Salvează</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Organizații</CardTitle>
        </CardHeader>
        <CardContent>
          {ctx.memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nu aparțineți niciunei organizații.</p>
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
          <CardTitle>Securitate</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <Link href="/update-password" className="underline-offset-4 hover:underline">
            Schimbă parola
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
