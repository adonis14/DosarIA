import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = { title: "Resetare parolă" };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resetare parolă</CardTitle>
        <CardDescription>Introduceți adresa de e-mail a contului.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={forgotPasswordAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
            <FieldError name="email" />
          </div>
          <SubmitButton pendingLabel="Se trimite…">Trimite linkul de resetare</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-muted-foreground underline-offset-4 hover:underline">
            Înapoi la autentificare
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
