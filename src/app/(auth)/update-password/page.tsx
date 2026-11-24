import { updatePasswordAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePageContext } from "@/server/context";

export const metadata = { title: "Parolă nouă" };

export default async function UpdatePasswordPage() {
  await requirePageContext();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setați o parolă nouă</CardTitle>
        <CardDescription>Minimum 12 caractere, cu litere mari, mici și cifre.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={updatePasswordAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="password">Parolă nouă</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
            <FieldError name="password" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirmPassword">Confirmați parola</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            <FieldError name="confirmPassword" />
          </div>
          <SubmitButton pendingLabel="Se salvează…">Salvează parola</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  );
}
