import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Link invalid" };

export default function AuthErrorPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Link invalid sau expirat</CardTitle>
        <CardDescription>
          Linkul de confirmare sau de resetare nu mai este valabil. Linkurile pot fi folosite o singură dată.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4 text-sm">
        <Link href="/login" className="underline-offset-4 hover:underline">
          Autentificare
        </Link>
        <Link href="/forgot-password" className="underline-offset-4 hover:underline">
          Solicitați un link nou
        </Link>
      </CardContent>
    </Card>
  );
}
