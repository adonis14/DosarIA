import { Scale } from "lucide-react";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { getT } from "@/i18n/server";

export default async function AuthLayout({ children }: LayoutProps<"/">) {
  const t = await getT();
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <LanguageSwitcher className="absolute top-4 right-4" />
      <div className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Scale className="size-5" aria-hidden />
        DosarIA
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">{t.authLayout.disclaimer}</p>
    </main>
  );
}
