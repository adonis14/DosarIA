import Link from "next/link";
import { signupAction } from "@/app/actions/auth";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const metadata = { title: "Cont nou" };

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cont nou</CardTitle>
        <CardDescription>Veți primi un e-mail pentru confirmarea adresei.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={signupAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="fullName">Nume complet</Label>
            <Input id="fullName" name="fullName" autoComplete="name" required />
            <FieldError name="fullName" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">E-mail profesional</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
            <FieldError name="email" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Parolă</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
            <p className="text-xs text-muted-foreground">Minimum 12 caractere, cu litere mari, mici și cifre.</p>
            <FieldError name="password" />
          </div>
          <SubmitButton pendingLabel="Se creează…">Creează contul</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Aveți deja cont?{" "}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Autentificare
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
