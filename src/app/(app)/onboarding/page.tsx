import { redirect } from "next/navigation";
import { createOrganizationAction } from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePageContext } from "@/server/context";

export const metadata = { title: "Bun venit" };

export default async function OnboardingPage() {
  const ctx = await requirePageContext();
  if (ctx.activeOrg) redirect("/dashboard");

  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Bun venit în DosarIA" description="Contul dumneavoastră nu aparține încă unei organizații." />
      <Card>
        <CardHeader>
          <CardTitle>Ați primit o invitație?</CardTitle>
          <CardDescription>
            Deschideți linkul de invitație primit de la administratorul cabinetului. Veți fi adăugat cu rolul stabilit de acesta.
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Creați o organizație</CardTitle>
          <CardDescription>Veți deveni administratorul acesteia și veți putea invita colegi.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={createOrganizationAction} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="name">Denumirea cabinetului</Label>
              <Input id="name" name="name" placeholder="Cabinet de avocatură" required />
              <FieldError name="name" />
            </div>
            <div>
              <SubmitButton>Creează organizația</SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
