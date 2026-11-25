import { Languages } from "lucide-react";
import { setLocaleAction } from "@/app/actions/locale";
import { Button } from "@/components/ui/button";
import { LOCALES } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

/** EN / RO toggle. A plain form posting to a Server Action: works without JavaScript too. */
export async function LanguageSwitcher({ className }: { className?: string }) {
  const [locale, t] = await Promise.all([getLocale(), getT()]);
  return (
    <form action={setLocaleAction} className={cn("flex items-center gap-1", className)} data-testid="language-switcher">
      <Languages className="size-4 text-muted-foreground" aria-hidden />
      <span className="sr-only">{t.language.label}</span>
      {LOCALES.map((l) => (
        <Button
          key={l}
          type="submit"
          name="locale"
          value={l}
          variant={l === locale ? "secondary" : "ghost"}
          size="sm"
          className="h-7 px-2 text-xs"
          aria-pressed={l === locale}
          lang={l}
          title={t.language.names[l]}
        >
          {l.toUpperCase()}
        </Button>
      ))}
    </form>
  );
}
