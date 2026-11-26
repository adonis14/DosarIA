import type { Metadata } from "next";
import Link from "next/link";
import { markNotificationsReadAction, saveNotificationPreferencesAction } from "@/app/actions/notifications";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { label, type Dictionary, type Locale } from "@/i18n";
import { getT } from "@/i18n/server";
import { daysUntil, formatDate, formatDateTime } from "@/lib/format";
import { displayReminderText } from "@/lib/suggested-reminder";
import { cn } from "@/lib/utils";
import { requireOrgPageContext } from "@/server/context";
import {
  getMyUpcomingDeadlines,
  getNotificationPreferences,
  listNotifications,
  type NotificationRow,
} from "@/server/dal/notifications";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.notifications };
}

export default async function NotificationsPage() {
  const ctx = await requireOrgPageContext();
  const { t, locale } = ctx;
  const [items, deadlines, prefs] = await Promise.all([
    listNotifications(ctx),
    getMyUpcomingDeadlines(ctx),
    getNotificationPreferences(ctx),
  ]);
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t.notifications.title}
        description={t.notifications.description}
        actions={
          unread > 0 && (
            <ActionForm action={markNotificationsReadAction} showSuccess={false}>
              <input type="hidden" name="scope" value="all" />
              <SubmitButton variant="outline" size="sm">
                {t.notifications.markAllRead}
              </SubmitButton>
            </ActionForm>
          )
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t.notifications.deadlinesTitle}</CardTitle>
          <CardDescription>{t.notifications.deadlinesDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {deadlines.length === 0 ? (
            <EmptyState title={t.notifications.deadlinesEmpty} />
          ) : (
            <ul className="divide-y" data-testid="my-deadlines">
              {deadlines.map((d) => {
                const days = daysUntil(d.due_date);
                return (
                  <li key={d.id} className="flex items-start justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/cases/${d.case_id}`} className="font-medium hover:underline">
                        {displayReminderText(d, t.caseDetail).title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.court_case_number} · {d.case_title}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <div className="font-medium">{formatDate(d.due_date, locale)}</div>
                      <div className={days <= 3 ? "text-xs text-red-600" : "text-xs text-muted-foreground"}>
                        {days < 0 ? t.notifications.overdue : days === 0 ? t.notifications.dueToday : t.dashboard.inDays(days)}
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
        <CardContent className="pt-6">
          {items.length === 0 ? (
            <EmptyState title={t.notifications.empty}>{t.notifications.emptyHint}</EmptyState>
          ) : (
            <ul className="divide-y" data-testid="notifications">
              {items.map((n) => (
                <NotificationItem key={n.id} n={n} t={t} locale={locale} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t.notifications.settingsTitle}</CardTitle>
          <CardDescription>{t.notifications.settingsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={saveNotificationPreferencesAction} className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="courtUpdates" defaultChecked={prefs.courtUpdates} className="size-4" />
              {t.notifications.courtUpdates}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="checkProblems" defaultChecked={prefs.checkProblems} className="size-4" />
              {t.notifications.checkProblems}
            </label>
            <p className="text-xs text-muted-foreground">{t.notifications.alwaysOn}</p>
            <div>
              <SubmitButton variant="outline" size="sm">
                {t.notifications.save}
              </SubmitButton>
            </div>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}

function NotificationItem({ n, t, locale }: { n: NotificationRow; t: Dictionary; locale: Locale }) {
  const unread = !n.read_at;
  return (
    <li className={cn("grid gap-1 py-3", unread && "font-medium")} data-testid="notification" data-kind={n.kind} data-unread={unread}>
      <div className="flex flex-wrap items-center gap-2">
        {unread && <span className="size-2 rounded-full bg-primary" aria-label={t.notifications.unread} />}
        <Badge variant="outline">{label(t.notifications.kind, n.kind)}</Badge>
        <Link href={`/cases/${n.case_id}`} className="font-mono text-sm hover:underline">
          {n.cases?.court_case_number ?? "—"}
        </Link>
        <span className="truncate text-sm text-muted-foreground">{n.cases?.title}</span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">{formatDateTime(n.created_at, locale)}</span>
      </div>
      <p className="text-sm font-normal">{notificationText(n, t, locale)}</p>
      {unread && (
        <ActionForm action={markNotificationsReadAction} showSuccess={false}>
          <input type="hidden" name="notificationId" value={n.id} />
          <SubmitButton variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs">
            {t.notifications.markRead}
          </SubmitButton>
        </ActionForm>
      )}
    </li>
  );
}

function notificationText(n: NotificationRow, t: Dictionary, locale: Locale): string {
  const r = n.deadline_reminders;
  const e = n.case_events;
  switch (n.kind) {
    case "court_update":
      if (!e) return t.notifications.unavailable;
      return `${label(t.labels.eventType, e.event_type)}: ${locale === "en" && e.summary_en ? e.summary_en : e.summary_ro}`;
    case "check_problem":
      return t.notifications.checkProblem(n.check_outcome ? label(t.labels.checkOutcome, n.check_outcome) : "—");
    case "reminder_added": {
      if (!r) return t.notifications.unavailable;
      const title = displayReminderText(r, t.caseDetail).title;
      return r.origin === "suggested"
        ? t.notifications.reminderSuggested(title, formatDate(r.due_date, locale))
        : t.notifications.reminderAdded(title, formatDate(r.due_date, locale));
    }
    case "reminder_needs_review":
      if (!r) return t.notifications.unavailable;
      return t.notifications.reminderNeedsReview(displayReminderText(r, t.caseDetail).title, formatDate(r.due_date, locale));
    case "case_assigned":
      return t.notifications.caseAssigned;
  }
}
