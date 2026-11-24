import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Verificați e-mailul" };

export default function CheckEmailPage() {
  return (
    <Card>
      <CardHeader>
        <MailCheck className="size-6 text-muted-foreground" aria-hidden />
        <CardTitle>Verificați e-mailul</CardTitle>
        <CardDescription>
          Dacă adresa poate fi înregistrată, ați primit un link de confirmare. Contul devine activ după confirmare.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <Link href="/login" className="underline-offset-4 hover:underline">
          Înapoi la autentificare
        </Link>
      </CardContent>
    </Card>
  );
}
