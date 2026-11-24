import Link from "next/link";
import { notFound } from "next/navigation";
import { Archive, Info, Pencil, RefreshCw } from "lucide-react";
import { archiveCaseAction, assignCaseAction } from "@/app/actions/cases";
import { checkCaseAction } from "@/app/actions/monitoring";
import { createReminderAction, deleteReminderAction, reminderStatusAction } from "@/app/actions/reminders";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
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
import { formatDate, formatDateTime } from "@/lib/format";
import { ERROR_CODE_LABELS, EVENT_TYPE_LABELS, MATTER_TYPE_LABELS, label } from "@/lib/labels";
import { isAdminOf, requireOrgPageContext, roleIn } from "@/server/context";
import { canEditCase, getAuthorizedCase } from "@/server/dal/cases";
import { getAuthorizedCaseEvents, getCaseMonitoringRuns } from "@/server/dal/events";
import { listMembers } from "@/server/dal/organizations";
import { getCaseReminders, type ReminderRow } from "@/server/dal/reminders";

export const metadata = { title: "Dosar" };

export default async function CaseDetailPage({ params }: PageProps<"/cases/[caseId]">) {
  const { caseId } = await params;
  const ctx = await requireOrgPageContext();
  const c = await getAuthorizedCase(ctx, caseId);
  // Same response for "does not exist" and "not yours".
  if (!c) notFound();

  const [events, runs, reminders, members] = await Promise.all([
    getAuthorizedCaseEvents(ctx, c.id),
    getCaseMonitoringRuns(ctx, c.id),
    getCaseReminders(ctx, c.id),
    listMembers(ctx, c.organization_id),
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
            {c.court_name} · {label(MATTER_TYPE_LABELS, c.matter_type)} <CaseStatusBadge status={c.status} />
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/cases/${c.id}/edit`}>
                <Pencil aria-hidden />
                Editează
              </Link>
            </Button>
            {!archived && (
              <ActionForm action={archiveCaseAction}>
                <input type="hidden" name="caseId" value={c.id} />
                <SubmitButton variant="outline">
                  <Archive aria-hidden />
                  Arhivează
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
            <CardTitle>Monitorizare</CardTitle>
            <CardDescription>Sursă: furnizor simulat (date sintetice). Integrarea portal.just.ro nu este activă.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="monitoring-status">
              <div>
                <dt className="text-muted-foreground">Rezultatul ultimei verificări</dt>
                <dd className="mt-1">
                  <CheckOutcomeBadge outcome={c.last_check_outcome} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Stare la instanță (ultima verificare reușită)</dt>
                <dd className="mt-1 font-medium">{c.court_status ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ultima verificare reușită</dt>
                <dd className="mt-1 font-medium" data-testid="last-successful-check">
                  {formatDateTime(c.last_successful_check_at)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Ultima încercare</dt>
                <dd className="mt-1 font-medium">{formatDateTime(c.last_check_attempt_at)}</dd>
              </div>
            </dl>
            {!archived ? (
              <ActionForm action={checkCaseAction} className="grid gap-2">
                <input type="hidden" name="caseId" value={c.id} />
                <div>
                  <SubmitButton pendingLabel="Se verifică sursa…">
                    <RefreshCw aria-hidden />
                    Verifică actualizări
                  </SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted-foreground">Dosarul este arhivat; monitorizarea este oprită.</p>
            )}
            {runs.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Istoricul verificărilor ({runs.length})</summary>
                <ul className="mt-2 divide-y">
                  {runs.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                      <CheckOutcomeBadge outcome={r.outcome} />
                      <span className="text-muted-foreground">{formatDateTime(r.finished_at)}</span>
                      {r.events_created > 0 && <span>{r.events_created} eveniment(e)</span>}
                      {r.error_code && <span className="text-muted-foreground">{ERROR_CODE_LABELS[r.error_code] ?? r.error_code}</span>}
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
            <CardTitle>Alocare</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Avocat responsabil</p>
              <p className="font-medium" data-testid="assigned-lawyer">
                {c.assigned_user_id ? nameOf.get(c.assigned_user_id) ?? "—" : "Nealocat"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Asistent</p>
              <p className="font-medium">{c.assigned_assistant_id ? nameOf.get(c.assigned_assistant_id) ?? "—" : "—"}</p>
            </div>
            {isAdmin && (
              <ActionForm action={assignCaseAction} className="grid gap-2 border-t pt-3">
                <input type="hidden" name="caseId" value={c.id} />
                <Label htmlFor="assignedUserId">Schimbă avocatul</Label>
                <NativeSelect id="assignedUserId" name="assignedUserId" defaultValue={c.assigned_user_id ?? ""} className="w-full">
                  <NativeSelectOption value="">— Nealocat —</NativeSelectOption>
                  {activeMembers
                    .filter((m) => m.role !== "assistant")
                    .map((m) => (
                      <NativeSelectOption key={m.user_id} value={m.user_id}>
                        {nameOf.get(m.user_id)}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <Label htmlFor="assignedAssistantId">Asistent</Label>
                <NativeSelect
                  id="assignedAssistantId"
                  name="assignedAssistantId"
                  defaultValue={c.assigned_assistant_id ?? ""}
                  className="w-full"
                >
                  <NativeSelectOption value="">— Niciunul —</NativeSelectOption>
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
                    Salvează alocarea
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
          <CardTitle>Termene și mementouri</CardTitle>
          <CardDescription>
            DosarIA nu calculează termene procedurale. Datele sugerate din sursă și cele introduse manual devin termene
            confirmate doar după confirmarea explicită a unui avocat.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {reminders.length === 0 ? (
            <EmptyState title="Niciun termen" />
          ) : (
            <ul className="divide-y rounded-md border" data-testid="reminders">
              {reminders.map((r) => (
                <ReminderItem key={r.id} r={r} caseId={c.id} canEdit={canEdit} canConfirm={canConfirm} nameOf={nameOf} />
              ))}
            </ul>
          )}

          {canEdit && (
            <details className="rounded-md border p-4" open={reminders.length === 0}>
              <summary className="cursor-pointer text-sm font-medium">Adaugă un termen sau memento</summary>
              <ActionForm action={createReminderAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="caseId" value={c.id} />
                <div className="grid gap-2">
                  <Label htmlFor="title">Titlu</Label>
                  <Input id="title" name="title" placeholder="Depunere întâmpinare" required />
                  <FieldError name="title" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="dueDate">Data</Label>
                  <Input id="dueDate" name="dueDate" type="date" required />
                  <FieldError name="dueDate" />
                </div>
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="description">Descriere (opțional)</Label>
                  <Textarea id="description" name="description" rows={2} />
                  <FieldError name="description" />
                </div>
                <div className="sm:col-span-2">
                  <SubmitButton size="sm">Adaugă (statut „Propus”)</SubmitButton>
                </div>
              </ActionForm>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Update history */}
      <Card>
        <CardHeader>
          <CardTitle>Istoricul actualizărilor</CardTitle>
          <CardDescription className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Rezumatele sunt generate automat din șabloane, pe baza datelor publicate de sursă. Nu constituie consultanță
            juridică; verificați întotdeauna dosarul la instanță.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState title="Nicio actualizare înregistrată">Apăsați „Verifică actualizări” pentru prima verificare.</EmptyState>
          ) : (
            <ol className="grid gap-4" data-testid="events">
              {events.map((e) => (
                <li key={e.id} className="rounded-md border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{label(EVENT_TYPE_LABELS, e.event_type)}</Badge>
                    {e.requires_review && (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                        Necesită verificare umană
                      </Badge>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">Detectat {formatDateTime(e.detected_at)}</span>
                  </div>
                  <p className="mt-2 text-sm" lang="ro">
                    {e.summary_ro}
                  </p>
                  {e.summary_en && (
                    <details className="mt-1 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">English</summary>
                      <p lang="en" className="mt-1">
                        {e.summary_en}
                      </p>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {!canEdit && (
        <Alert>
          <AlertDescription>
            Aveți acces de citire la acest dosar. Modificările și confirmarea termenelor sunt rezervate avocatului alocat și
            administratorilor.
          </AlertDescription>
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
}: {
  r: ReminderRow;
  caseId: string;
  canEdit: boolean;
  canConfirm: boolean;
  nameOf: Map<string, string>;
}) {
  const actions: { action: string; label: string; variant?: "default" | "outline" }[] = [];
  if (canConfirm && (r.status === "proposed" || r.status === "needs_review")) {
    actions.push({ action: "confirm", label: "Confirm termenul", variant: "default" });
  }
  if (canConfirm && r.status === "confirmed") actions.push({ action: "complete", label: "Marchează finalizat" });
  if (canConfirm && r.status === "completed") actions.push({ action: "reopen", label: "Redeschide" });
  if (canEdit && (r.status === "proposed" || r.status === "confirmed")) actions.push({ action: "flag", label: "Necesită verificare" });

  return (
    <li className="grid gap-2 p-4" data-testid="reminder" data-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{r.title}</span>
        <span className="text-sm text-muted-foreground">· {formatDate(r.due_date)}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          <ReminderOriginBadge origin={r.origin} />
          <ReminderStatusBadge status={r.status} />
        </span>
      </div>
      {r.description && <p className="text-sm text-muted-foreground">{r.description}</p>}
      {r.status !== "confirmed" && r.status !== "completed" && (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Neconfirmat — nu reprezintă un termen legal verificat.
        </p>
      )}
      {r.confirmed_at && r.confirmed_by && (
        <p className="text-xs text-muted-foreground">
          Confirmat de {nameOf.get(r.confirmed_by) ?? "—"} la {formatDateTime(r.confirmed_at)}
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
                Șterge
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      )}
    </li>
  );
}
