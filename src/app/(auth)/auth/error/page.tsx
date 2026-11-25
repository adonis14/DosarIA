import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.authError };
}

export default async function AuthErrorPage() {
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.authError.title}</CardTitle>
        <CardDescription>{t.authError.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-4 text-sm">
        <Link href="/login" className="underline-offset-4 hover:underline">
          {t.common.signIn}
        </Link>
        <Link href="/forgot-password" className="underline-offset-4 hover:underline">
          {t.authError.requestNew}
        </Link>
      </CardContent>
    </Card>
  );
}
