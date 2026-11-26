import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Info, Pencil, RefreshCw } from "lucide-react";
import { archiveCaseAction, assignCaseAction } from "@/app/actions/cases";
import { checkCaseAction } from "@/app/actions/monitoring";
import { followCaseAction } from "@/app/actions/notifications";
import { createReminderAction, deleteReminderAction, reminderStatusAction } from "@/app/actions/reminders";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { CourtText } from "@/components/app/court-text";
import { EmptyState } from "@/components/app/page-header";
import {
  CaseStatusBadge,
  CheckOutcomeBadge,
  ReminderOriginBadge,
  ReminderStatusBadge,
} from "@/components/app/status-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { label, type Dictionary, type Locale } from "@/i18n";
import { getT } from "@/i18n/server";
import { serverEnv } from "@/lib/env";
import { formatDate, formatDateTime } from "@/lib/format";
import { displayReminderText } from "@/lib/suggested-reminder";
import { isAdminOf, requireOrgPageContext, roleIn } from "@/server/context";
import { canEditCase, getAuthorizedCase } from "@/server/dal/cases";
import { getAuthorizedCaseEvents, getCaseCheckSchedule, getCaseMonitoringRuns, type CheckScheduleRow } from "@/server/dal/events";
import { getCaseAlertStatus } from "@/server/dal/notifications";
import { listMembers } from "@/server/dal/organizations";
import { getCaseReminders, type ReminderRow } from "@/server/dal/reminders";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.caseDetail };
}

export default async function CaseDetailPage({ params }: PageProps<"/cases/[caseId]">) {
  const { caseId } = await params;
  const ctx = await requireOrgPageContext();
  const { t, locale } = ctx;
  const c = await getAuthorizedCase(ctx, caseId);
  // Same response for "does not exist" and "not yours".
  if (!c) notFound();

  const [events, runs, schedule, reminders, members, alerts] = await Promise.all([
    getAuthorizedCaseEvents(ctx, c.id),
    getCaseMonitoringRuns(ctx, c.id),
    getCaseCheckSchedule(ctx, c.id),
    getCaseReminders(ctx, c.id),
    listMembers(ctx, c.organization_id),
    getCaseAlertStatus(ctx, c),
  ]);

  const role = roleIn(ctx, c.organization_id);
  const canEdit = canEditCase(ctx, c);
  const canConfirm = canEdit && (role === "admin" || role === "lawyer");
  const isAdmin = isAdminOf(ctx, c.organization_id);
  const nameOf = new Map(members.map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || "—"]));
  const activeMembers = members.filter((m) => m.status === "active");
  const archived = c.status === "archived";

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm text-muted-foreground" data-testid="case-number">
            {c.court_case_number}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <CourtText value={c.court_name} kind="court" /> · {label(t.labels.matterType, c.matter_type)}{" "}
            <CaseStatusBadge status={c.status} />
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/cases/${c.id}/edit`}>
                <Pencil aria-hidden />
                {t.caseDetail.edit}
              </Link>
            </Button>
            {!archived && (
              <ActionForm action={archiveCaseAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <SubmitButton variant="outline">
                  <Archive aria-hidden />
                  {t.caseDetail.archive}
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Monitoring */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.caseDetail.monitoringTitle}</CardTitle>
            <CardDescription>
              {serverEnv().COURT_DATA_PROVIDER === "portaljust_soap" ? t.caseDetail.sourcePortal : t.caseDetail.sourceMock}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="monitoring-status">
              <div>
                <dt className="text-muted-foreground">{t.caseDetail.lastOutcome}</dt>
                <dd className="mt-1">
                  <CheckOutcomeBadge outcome={c.last_check_outcome} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t.caseDetail.courtStatus}</dt>
                <dd className="mt-1 font-medium">
                  <CourtText value={c.court_status} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t.caseDetail.lastSuccess}</dt>
                <dd className="mt-1 font-medium" data-testid="last-successful-check">
                  {formatDateTime(c.last_successful_check_at, locale)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t.caseDetail.lastAttempt}</dt>
                <dd className="mt-1 font-medium">{formatDateTime(c.last_check_attempt_at, locale)}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground">{t.caseDetail.nextCheck}</dt>
                <dd className="mt-1" data-testid="next-check">
                  <NextCheck enabled={serverEnv().SCHEDULED_CHECKS_ENABLED} active={c.status === "active"} schedule={schedule} t={t} locale={locale} />
                </dd>
              </div>
            </dl>
            {!archived ? (
              <ActionForm action={checkCaseAction} className="grid gap-2">
                <input type="hidden" name="caseId" value={c.id} />
                <div>
                  <SubmitButton pendingLabel={t.caseDetail.checking}>
                    <RefreshCw aria-hidden />
                    {t.caseDetail.check}
                  </SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted-foreground">{t.caseDetail.archived}</p>
            )}
            {runs.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">{t.caseDetail.runHistory(runs.length)}</summary>
                <ul className="mt-2 divide-y">
                  {runs.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                      <CheckOutcomeBadge outcome={r.outcome} />
                      <span className="text-muted-foreground">{formatDateTime(r.finished_at, locale)}</span>
                      {r.events_created > 0 && <span>{t.caseDetail.runEvents(r.events_created)}</span>}
                      {r.error_code && <span className="text-muted-foreground">{label(t.labels.errorCode, r.error_code)}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>

        {/* Assignment */}
        <Card>
          <CardHeader>
            <CardTitle>{t.caseDetail.assignmentTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">{t.caseDetail.responsibleLawyer}</p>
              <p className="font-medium" data-testid="assigned-lawyer">
                {c.assigned_user_id ? (nameOf.get(c.assigned_user_id) ?? "—") : t.common.unassigned}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t.caseDetail.assistant}</p>
              <p className="font-medium">{c.assigned_assistant_id ? nameOf.get(c.assigned_assistant_id) ?? "—" : "—"}</p>
            </div>
            <div className="grid gap-2 border-t pt-3" data-testid="case-alerts" data-status={alerts}>
              <p className="text-muted-foreground">{t.caseDetail.alertsLabel}</p>
              <p>
                {alerts === "assigned"
                  ? t.caseDetail.alertsAssigned
                  : alerts === "following"
                    ? t.caseDetail.alertsFollowing
                    : t.caseDetail.alertsNotFollowing}
              </p>
              {alerts !== "assigned" && (!archived || alerts === "following") && (
                <ActionForm action={followCaseAction} showSuccess={false}>
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="follow" value={alerts === "following" ? "off" : "on"} />
                  <SubmitButton size="sm" variant="outline">
                    {alerts === "following" ? t.caseDetail.unfollow : t.caseDetail.follow}
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
            {isAdmin && (
              <ActionForm action={assignCaseAction} className="grid gap-2 border-t pt-3">
                <input type="hidden" name="caseId" value={c.id} />
                <Label htmlFor="assignedUserId">{t.caseDetail.changeLawyer}</Label>
                <NativeSelect id="assignedUserId" name="assignedUserId" defaultValue={c.assigned_user_id ?? ""} className="w-full">
                  <NativeSelectOption value="">{t.common.unassignedOption}</NativeSelectOption>
                  {activeMembers
                    .filter((m) => m.role !== "assistant")
                    .map((m) => (
                      <NativeSelectOption key={m.user_id} value={m.user_id}>
                        {nameOf.get(m.user_id)}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <Label htmlFor="assignedAssistantId">{t.caseDetail.assistant}</Label>
                <NativeSelect
                  id="assignedAssistantId"
                  name="assignedAssistantId"
                  defaultValue={c.assigned_assistant_id ?? ""}
                  className="w-full"
                >
                  <NativeSelectOption value="">{t.common.noneOption}</NativeSelectOption>
                  {activeMembers
                    .filter((m) => m.role === "assistant")
                    .map((m) => (
                      <NativeSelectOption key={m.user_id} value={m.user_id}>
                        {nameOf.get(m.user_id)}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <div>
                  <SubmitButton size="sm" variant="outline">
                    {t.caseDetail.saveAssignment}
                  </SubmitButton>
                </div>
              </ActionForm>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reminders */}
      <Card>
        <CardHeader>
          <CardTitle>{t.caseDetail.remindersTitle}</CardTitle>
          <CardDescription>{t.caseDetail.remindersDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {reminders.length === 0 ? (
            <EmptyState title={t.caseDetail.remindersEmpty} />
          ) : (
            <ul className="divide-y rounded-md border" data-testid="reminders">
              {reminders.map((r) => (
                <ReminderItem
                  key={r.id}
                  r={r}
                  caseId={c.id}
                  canEdit={canEdit}
                  canConfirm={canConfirm}
                  nameOf={nameOf}
                  t={t}
                  locale={locale}
                />
              ))}
            </ul>
          )}

          {canEdit && (
            <details className="rounded-md border p-4" open={reminders.length === 0}>
              <summary className="cursor-pointer text-sm font-medium">{t.caseDetail.addReminder}</summary>
              <ActionForm action={createReminderAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="grid gap-2">
                  <Label htmlFor="title">{t.caseDetail.reminderTitle}</Label>
                  <Input id="title" name="title" placeholder={t.caseDetail.reminderTitlePlaceholder} required />
                  <FieldError name="title" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="dueDate">{t.caseDetail.reminderDate}</Label>
                  <Input id="dueDate" name="dueDate" type="date" required />
                  <FieldError name="dueDate" />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="description">{t.caseDetail.reminderDescription}</Label>
                  <Textarea id="description" name="description" rows={2} />
                  <FieldError name="description" />
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton size="sm">{t.caseDetail.addReminderSubmit}</SubmitButton>
                </div>
              </ActionForm>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Update history */}
      <Card>
        <CardHeader>
          <CardTitle>{t.caseDetail.eventsTitle}</CardTitle>
          <CardDescription className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t.caseDetail.eventsDescription}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState title={t.caseDetail.eventsEmpty}>{t.caseDetail.eventsEmptyHint}</EmptyState>
          ) : (
            <ol className="grid gap-4" data-testid="events">
              {events.map((e) => (
                <li key={e.id} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{label(t.labels.eventType, e.event_type)}</Badge>
                    {e.requires_review && (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                        {t.caseDetail.humanReview}
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t.caseDetail.detected(formatDateTime(e.detected_at, locale))}
                    </span>
                  </div>
                  <EventSummary ro={e.summary_ro} en={e.summary_en} locale={locale} otherLabel={t.caseDetail.otherLanguageSummary} />
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {!canEdit && (
        <Alert>
          <AlertDescription>{t.caseDetail.readOnly}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ReminderItem({
  r,
  caseId,
  canEdit,
  canConfirm,
  nameOf,
  t,
  locale,
}: {
  r: ReminderRow;
  caseId: string;
  canEdit: boolean;
  canConfirm: boolean;
  nameOf: Map<string, string>;
  t: Dictionary;
  locale: Locale;
}) {
  const text = displayReminderText(r, t.caseDetail);
  const actions: { action: string; label: string; variant?: "default" | "outline" }[] = [];
  if (canConfirm && (r.status === "proposed" || r.status === "needs_review")) {
    actions.push({ action: "confirm", label: t.caseDetail.actionConfirm, variant: "default" });
  }
  if (canConfirm && r.status === "confirmed") actions.push({ action: "complete", label: t.caseDetail.actionComplete });
  if (canConfirm && r.status === "completed") actions.push({ action: "reopen", label: t.caseDetail.actionReopen });
  if (canEdit && (r.status === "proposed" || r.status === "confirmed")) actions.push({ action: "flag", label: t.caseDetail.actionFlag });

  return (
    <li className="grid gap-2 p-4" data-testid="reminder" data-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{text.title}</span>
        <span className="text-sm text-muted-foreground">· {formatDate(r.due_date, locale)}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          <ReminderOriginBadge origin={r.origin} />
          <ReminderStatusBadge status={r.status} />
        </span>
      </div>
      {text.description && <p className="text-sm text-muted-foreground">{text.description}</p>}
      {r.status !== "confirmed" && r.status !== "completed" && (
        <p className="text-xs text-amber-800 dark:text-amber-300">{t.caseDetail.unconfirmedWarning}</p>
      )}
      {r.confirmed_at && r.confirmed_by && (
        <p className="text-xs text-muted-foreground">
          {t.caseDetail.confirmedBy(nameOf.get(r.confirmed_by) ?? "—", formatDateTime(r.confirmed_at, locale))}
        </p>
      )}
      {(actions.length > 0 || (canEdit && (r.status === "proposed" || r.status === "needs_review"))) && (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <ActionForm key={a.action} action={reminderStatusAction}>
              <input type="hidden" name="reminderId" value={r.id} />
              <input type="hidden" name="caseId" value={caseId} />
              <input type="hidden" name="action" value={a.action} />
              <SubmitButton size="sm" variant={a.variant ?? "outline"}>
                {a.label}
              </SubmitButton>
            </ActionForm>
          ))}
          {canEdit && (r.status === "proposed" || r.status === "needs_review") && (
            <ActionForm action={deleteReminderAction}>
              <input type="hidden" name="reminderId" value={r.id} />
              <input type="hidden" name="caseId" value={caseId} />
              <SubmitButton size="sm" variant="ghost">
                {t.caseDetail.delete}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </li>
  );
}

/** Summary in the interface language; the other language is available on demand. */
function EventSummary({ ro, en, locale, otherLabel }: { ro: string; en: string | null; locale: Locale; otherLabel: string }) {
  const primary = locale === "en" && en ? { text: en, lang: "en" } : { text: ro, lang: "ro" };
  const secondary = primary.lang === "en" ? { text: ro, lang: "ro" } : en ? { text: en, lang: "en" } : null;
  return (
    <>
      <p className="mt-2 text-sm" lang={primary.lang}>
        {primary.text}
      </p>
      {secondary && (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer">{otherLabel}</summary>
          <p lang={secondary.lang} className="mt-1">
            {secondary.text}
          </p>
        </details>
      )}
    </>
  );
}

/** When the case is next checked automatically, and why. */
function NextCheck({
  enabled,
  active,
  schedule,
  t,
  locale,
}: {
  enabled: boolean;
  active: boolean;
  schedule: CheckScheduleRow | null;
  t: Dictionary;
  locale: Locale;
}) {
  if (!enabled) return <span className="text-muted-foreground">{t.caseDetail.nextCheckOff}</span>;
  if (!active) return <span className="text-muted-foreground">{t.caseDetail.nextCheckInactive}</span>;
  if (!schedule) return <span className="font-medium">{t.caseDetail.nextCheckSoon}</span>;
  return (
    <>
      <span className="font-medium">{formatDateTime(schedule.next_check_at, locale)}</span>
      <span className="text-muted-foreground"> · {label(t.labels.nextCheckReason, schedule.reason)}</span>
    </>
  );
}
