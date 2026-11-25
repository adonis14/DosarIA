import Link from "next/link";
import { LogOut, Scale } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { switchOrganizationAction } from "@/app/actions/organization";
import { LanguageSwitcher } from "@/components/app/language-switcher";
import { RoleBadge } from "@/components/app/status-badges";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { requirePageContext } from "@/server/context";

// Every page below is private and per-user: always render on the server per request.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requirePageContext();
  const { t } = ctx;
  const isAdmin = ctx.activeOrg?.role === "admin";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
            <Scale className="size-5" aria-hidden />
            DosarIA
          </Link>
          {ctx.activeOrg && (
            <nav className="flex items-center gap-4 text-sm" aria-label={t.nav.mainLabel}>
              <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">
                {t.nav.dashboard}
              </Link>
              <Link href="/cases" className="text-muted-foreground hover:text-foreground">
                {t.nav.cases}
              </Link>
              <Link href="/settings" className="text-muted-foreground hover:text-foreground">
                {isAdmin ? t.nav.organization : t.nav.team}
              </Link>
            </nav>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            {ctx.memberships.length > 1 ? (
              <form action={switchOrganizationAction} className="flex items-center gap-2">
                <label htmlFor="org-switch" className="sr-only">
                  {t.nav.activeOrganization}
                </label>
                <NativeSelect id="org-switch" name="organizationId" defaultValue={ctx.activeOrg?.organizationId} size="sm">
                  {ctx.memberships.map((m) => (
                    <NativeSelectOption key={m.organizationId} value={m.organizationId}>
                      {m.organizationName}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button type="submit" variant="outline" size="sm">
                  {t.nav.switchOrganization}
                </Button>
              </form>
            ) : (
              ctx.activeOrg && <span className="text-muted-foreground">{ctx.activeOrg.organizationName}</span>
            )}
            {ctx.activeOrg && <RoleBadge role={ctx.activeOrg.role} />}
            <Link href="/profile" className="text-muted-foreground hover:text-foreground" data-testid="current-user">
              {ctx.user.email}
            </Link>
            <LanguageSwitcher />
            <form action={logoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut aria-hidden />
                {t.nav.logout}
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">{t.footer.text}</footer>
    </div>
  );
}
