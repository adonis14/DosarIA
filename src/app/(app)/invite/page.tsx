import type { Metadata } from "next";
import { acceptInvitationAction } from "@/app/actions/organization";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { invitationTokenSchema } from "@/lib/validation";
import { requirePageContext } from "@/server/context";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.invite, referrer: "no-referrer" };
}

export default async function InvitePage({ searchParams }: PageProps<"/invite">) {
  const ctx = await requirePageContext();
  const { t } = ctx;
  const sp = await searchParams;
  const token = invitationTokenSchema.safeParse(sp.token);

  if (!token.success) {
    return (
      <Alert variant="destructive" className="max-w-xl">
        <AlertTitle>{t.invite.invalidTitle}</AlertTitle>
        <AlertDescription>{t.invite.invalidDescription}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t.invite.title}</CardTitle>
        <CardDescription>{t.invite.description(ctx.user.email)}</CardDescription>
      </CardHeader>
      <CardContent>
        {!ctx.user.emailVerified && (
          <Alert className="mb-4">
            <AlertDescription>{t.invite.confirmFirst}</AlertDescription>
          </Alert>
        )}
        <ActionForm action={acceptInvitationAction} className="grid gap-3">
          <input type="hidden" name="token" value={token.data} />
          <div>
            <SubmitButton>{t.invite.submit}</SubmitButton>
          </div>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
