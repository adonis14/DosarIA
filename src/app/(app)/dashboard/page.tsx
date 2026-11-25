import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, FolderOpen, ListChecks, ShieldAlert } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { CheckOutcomeBadge } from "@/components/app/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { label } from "@/i18n";
import { getT } from "@/i18n/server";
import { daysUntil, formatDate, formatDateTime } from "@/lib/format";
import { displayReminderText } from "@/lib/suggested-reminder";
import { requireOrgPageContext } from "@/server/context";
import { getDashboardStats } from "@/server/dal/dashboard";
import { getRecentEvents } from "@/server/dal/events";
import { getUpcomingConfirmedReminders } from "@/server/dal/reminders";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.dashboard };
}

export default async function DashboardPage() {
  const ctx = await requireOrgPageContext();
  const { t, locale } = ctx;
  const [stats, upcoming, recent] = await Promise.all([
    getDashboardStats(ctx),
    getUpcomingConfirmedReminders(ctx),
    getRecentEvents(ctx, 8),
  ]);
  const scope = ctx.activeOrg.role === "admin" ? t.dashboard.scopeAdmin : t.dashboard.scopeLawyer;

  return (
    <>
      <PageHeader title={t.dashboard.title} description={`${ctx.activeOrg.organizationName} · ${scope}`} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FolderOpen} title={t.dashboard.statCases} value={stats.totalCases} href="/cases" />
        <StatCard icon={CalendarClock} title={t.dashboard.statConfirmed} value={upcoming.length} />
        <StatCard icon={ListChecks} title={t.dashboard.statProposed} value={stats.proposedReminders} />
        <StatCard
          icon={ShieldAlert}
          title={t.dashboard.statReview}
          value={stats.remindersNeedingReview + stats.casesNeedingAttention.length}
          warn
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.upcomingTitle}</CardTitle>
            <CardDescription>{t.dashboard.upcomingDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <EmptyState title={t.dashboard.upcomingEmpty} />
            ) : (
              <ul className="divide-y" data-testid="upcoming-reminders">
                {upcoming.map((r) => {
                  const days = daysUntil(r.due_date);
                  return (
                    <li key={r.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <Link href={`/cases/${r.case_id}`} className="font-medium hover:underline">
                          {displayReminderText(r, t.caseDetail).title}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.cases?.court_case_number} · {r.cases?.title}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <div className="font-medium">{formatDate(r.due_date, locale)}</div>
                        <div className={days <= 3 ? "text-xs text-red-600" : "text-xs text-muted-foreground"}>
                          {days === 0 ? t.dashboard.today : t.dashboard.inDays(days)}
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
            <CardTitle>{t.dashboard.recentTitle}</CardTitle>
            <CardDescription>{t.dashboard.recentDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <EmptyState title={t.dashboard.recentEmpty}>{t.dashboard.recentEmptyHint}</EmptyState>
            ) : (
              <ul className="divide-y">
                {recent.map((e) => {
                  const summary = locale === "en" && e.summary_en ? e.summary_en : e.summary_ro;
                  return (
                    <li key={e.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{label(t.labels.eventType, e.event_type)}</Badge>
                        {e.requires_review && (
                          <Badge variant="outline" className="border-amber-300 text-amber-800">
                            {t.dashboard.needsReview}
                          </Badge>
                        )}
                        <Link href={`/cases/${e.case_id}`} className="text-sm font-medium hover:underline">
                          {e.cases?.court_case_number}
                        </Link>
                        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(e.detected_at, locale)}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground" lang={summary === e.summary_ro ? "ro" : "en"}>
                        {summary}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.attentionTitle}</CardTitle>
            <CardDescription>{t.dashboard.attentionDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.casesNeedingAttention.length === 0 && stats.remindersNeedingReview === 0 ? (
              <EmptyState title={t.dashboard.attentionEmpty} />
            ) : (
              <ul className="divide-y">
                {stats.remindersNeedingReview > 0 && (
                  <li className="py-3 text-sm">{t.dashboard.remindersNeedingReview(stats.remindersNeedingReview)}</li>
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
            <CardTitle>{t.dashboard.monitoringTitle}</CardTitle>
            <CardDescription>{t.dashboard.monitoringDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.totalCases === 0 ? (
              <EmptyState title={t.dashboard.noCases}>
                <Link href="/cases/new" className="underline">
                  {t.dashboard.addFirstCase}
                </Link>
              </EmptyState>
            ) : (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {Object.keys(t.labels.checkOutcome).map((key) => (
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
