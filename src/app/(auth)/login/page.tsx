import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextPath } from "@/lib/security/redirects";

export const metadata = { title: "Autentificare" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Autentificare</CardTitle>
        <CardDescription>Accesați dosarele cabinetului dumneavoastră.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={loginAction} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="grid gap-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Parolă</Label>
              <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                Ați uitat parola?
              </Link>
            </div>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <SubmitButton pendingLabel="Se verifică…">Intră în cont</SubmitButton>
        </ActionForm>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Nu aveți cont?{" "}
          <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            Creați un cont
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
