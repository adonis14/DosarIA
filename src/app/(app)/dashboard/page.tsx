import Link from "next/link";
import { CalendarClock, FolderOpen, ListChecks, ShieldAlert } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { CheckOutcomeBadge } from "@/components/app/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { daysUntil, formatDate, formatDateTime } from "@/lib/format";
import { CHECK_OUTCOME_LABELS, EVENT_TYPE_LABELS, label } from "@/lib/labels";
import { requireOrgPageContext } from "@/server/context";
import { getDashboardStats } from "@/server/dal/dashboard";
import { getRecentEvents } from "@/server/dal/events";
import { getUpcomingConfirmedReminders } from "@/server/dal/reminders";

export const metadata = { title: "Panou" };

export default async function DashboardPage() {
  const ctx = await requireOrgPageContext();
  const [stats, upcoming, recent] = await Promise.all([
    getDashboardStats(ctx),
    getUpcomingConfirmedReminders(ctx),
    getRecentEvents(ctx, 8),
  ]);
  const scope = ctx.activeOrg.role === "admin" ? "toate dosarele organizației" : "dosarele alocate dumneavoastră";

  return (
    <>
      <PageHeader title="Panou" description={`${ctx.activeOrg.organizationName} · ${scope}`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FolderOpen} title="Dosare monitorizate" value={stats.totalCases} href="/cases" />
        <StatCard icon={CalendarClock} title="Termene confirmate (60 zile)" value={upcoming.length} />
        <StatCard icon={ListChecks} title="Termene propuse, neconfirmate" value={stats.proposedReminders} />
        <StatCard
          icon={ShieldAlert}
          title="Necesită verificare"
          value={stats.remindersNeedingReview + stats.casesNeedingAttention.length}
          warn
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Termene confirmate următoare</CardTitle>
            <CardDescription>Doar termenele confirmate explicit de un avocat.</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <EmptyState title="Niciun termen confirmat în următoarele 60 de zile" />
            ) : (
              <ul className="divide-y" data-testid="upcoming-reminders">
                {upcoming.map((r) => {
                  const days = daysUntil(r.due_date);
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <Link href={`/cases/${r.case_id}`} className="font-medium hover:underline">
                          {r.title}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.cases?.court_case_number} · {r.cases?.title}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <div className="font-medium">{formatDate(r.due_date)}</div>
                        <div className={days <= 3 ? "text-xs text-red-600" : "text-xs text-muted-foreground"}>
                          {days === 0 ? "astăzi" : `în ${days} zile`}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actualizări recente din dosare</CardTitle>
            <CardDescription>Detectate la verificările manuale (sursă simulată).</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState title="Nicio actualizare încă">Deschideți un dosar și apăsați „Verifică actualizări”.</EmptyState>
            ) : (
              <ul className="divide-y">
                {recent.map((e) => (
                  <li key={e.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{label(EVENT_TYPE_LABELS, e.event_type)}</Badge>
                      {e.requires_review && (
                        <Badge variant="outline" className="border-amber-300 text-amber-800">
                          Necesită verificare
                        </Badge>
                      )}
                      <Link href={`/cases/${e.case_id}`} className="text-sm font-medium hover:underline">
                        {e.cases?.court_case_number}
                      </Link>
                      <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(e.detected_at)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{e.summary_ro}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dosare care necesită atenție</CardTitle>
            <CardDescription>Ultima verificare a eșuat, a returnat date incomplete sau sursa a fost indisponibilă.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.casesNeedingAttention.length === 0 && stats.remindersNeedingReview === 0 ? (
              <EmptyState title="Nimic de verificat" />
            ) : (
              <ul className="divide-y">
                {stats.remindersNeedingReview > 0 && (
                  <li className="py-3 text-sm">
                    {stats.remindersNeedingReview} termen(e) marcate „Necesită verificare” (de ex. termen de judecată mutat).
                  </li>
                )}
                {stats.casesNeedingAttention.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                    <Link href={`/cases/${c.id}`} className="min-w-0 truncate text-sm font-medium hover:underline">
                      {c.court_case_number} · {c.title}
                    </Link>
                    <CheckOutcomeBadge outcome={c.last_check_outcome} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Starea monitorizării</CardTitle>
            <CardDescription>Rezultatul ultimei verificări, pe dosare.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.totalCases === 0 ? (
              <EmptyState title="Niciun dosar">
                <Link href="/cases/new" className="underline">
                  Adăugați primul dosar
                </Link>
              </EmptyState>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {Object.entries(CHECK_OUTCOME_LABELS).map(([key]) => (
                  <div key={key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                    <dt>
                      <CheckOutcomeBadge outcome={key} />
                    </dt>
                    <dd className="font-semibold tabular-nums">{stats.monitoring[key] ?? 0}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  title,
  value,
  href,
  warn,
}: {
  icon: typeof FolderOpen;
  title: string;
  value: number;
  href?: string;
  warn?: boolean;
}) {
  const body = (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" aria-hidden />
          {title}
        </CardDescription>
        <CardTitle className={`text-3xl tabular-nums ${warn && value > 0 ? "text-amber-700" : ""}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
