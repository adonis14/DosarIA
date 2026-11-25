import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.checkEmail };
}

export default async function CheckEmailPage() {
  const t = await getT();
  return (
    <Card>
      <CardHeader>
        <MailCheck className="size-6 text-muted-foreground" aria-hidden />
        <CardTitle>{t.checkEmail.title}</CardTitle>
        <CardDescription>{t.checkEmail.description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <Link href="/login" className="underline-offset-4 hover:underline">
          {t.common.backToLogin}
        </Link>
      </CardContent>
    </Card>
  );
}
