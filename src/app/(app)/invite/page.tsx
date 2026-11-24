import { acceptInvitationAction } from "@/app/actions/organization";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { invitationTokenSchema } from "@/lib/validation";
import { requirePageContext } from "@/server/context";

export const metadata = { title: "Invitație", referrer: "no-referrer" };

export default async function InvitePage({ searchParams }: PageProps<"/invite">) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const token = invitationTokenSchema.safeParse(sp.token);

  if (!token.success) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>Invitație invalidă</AlertTitle>
        <AlertDescription>Linkul este incomplet sau invalid. Cereți administratorului o invitație nouă.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Acceptați invitația</CardTitle>
        <CardDescription>
          Invitația este valabilă doar pentru adresa cu care sunteți autentificat ({ctx.user.email}), dacă aceasta este
          confirmată.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!ctx.user.emailVerified && (
          <Alert className="mb-4">
            <AlertDescription>Confirmați mai întâi adresa de e-mail folosind linkul primit la înregistrare.</AlertDescription>
          </Alert>
        )}
        <ActionForm action={acceptInvitationAction} className="grid gap-3">
          <input type="hidden" name="token" value={token.data} />
          <div>
            <SubmitButton>Accept invitația</SubmitButton>
          </div>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
