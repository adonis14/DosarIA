import { Lock } from "lucide-react";
import { addCaseNoteAction, deleteCaseNoteAction, updateCaseNoteAction } from "@/app/actions/labels-notes";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Dictionary, Locale } from "@/i18n";
import { formatDateTime } from "@/lib/format";
import type { CaseNoteRow } from "@/lib/shared-types";

function PrivateCheckbox({ t, id, defaultChecked }: { t: Dictionary; id: string; defaultChecked?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input id={id} type="checkbox" name="private" defaultChecked={defaultChecked} className="size-4" />
      {t.caseNotes.privateLabel}
    </label>
  );
}

/** Internal notes on a case. Team notes: everyone who can read the case. Private: the author only. */
export function CaseNotesCard({
  t,
  locale,
  caseId,
  notes,
  currentUserId,
  nameOf,
}: {
  t: Dictionary;
  locale: Locale;
  caseId: string;
  notes: CaseNoteRow[];
  currentUserId: string;
  nameOf: Map<string, string>;
}) {
  return (
    <Card data-testid="case-notes">
      <CardHeader>
        <CardTitle>{t.caseNotes.title}</CardTitle>
        <CardDescription>{t.caseNotes.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ActionForm action={addCaseNoteAction} className="grid gap-2" showSuccess={false}>
          <input type="hidden" name="caseId" value={caseId} />
          <Label htmlFor="note-body" className="sr-only">
            {t.caseNotes.newNote}
          </Label>
          <Textarea id="note-body" name="body" rows={3} maxLength={5000} required placeholder={t.caseNotes.placeholder} />
          <FieldError name="body" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <PrivateCheckbox t={t} id="note-private" />
            <SubmitButton size="sm">{t.caseNotes.add}</SubmitButton>
          </div>
        </ActionForm>

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.caseNotes.empty}</p>
        ) : (
          <ol className="grid gap-3">
            {notes.map((n) => {
              const mine = n.author_id === currentUserId;
              const edited = new Date(n.updated_at).getTime() - new Date(n.created_at).getTime() > 1000;
              return (
                <li key={n.id} className="rounded-md border p-3 text-sm" data-testid="case-note">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{mine ? t.caseNotes.you : (nameOf.get(n.author_id) ?? "—")}</span>
                    <span>{formatDateTime(n.created_at, locale)}</span>
                    {edited && <span>· {t.caseNotes.edited}</span>}
                    {n.visibility === "private" && (
                      <Badge variant="outline" data-testid="note-private">
                        <Lock aria-hidden />
                        {t.caseNotes.privateBadge}
                      </Badge>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{n.body}</p>
                  {mine && (
                    <div className="mt-2 flex flex-wrap items-start gap-3">
                      <details className="grow">
                        <summary className="cursor-pointer text-xs text-muted-foreground">{t.caseNotes.edit}</summary>
                        <ActionForm action={updateCaseNoteAction} className="mt-2 grid gap-2">
                          <input type="hidden" name="noteId" value={n.id} />
                          <Label htmlFor={`note-edit-${n.id}`} className="sr-only">
                            {t.caseNotes.edit}
                          </Label>
                          <Textarea id={`note-edit-${n.id}`} name="body" rows={3} maxLength={5000} defaultValue={n.body} required />
                          <FieldError name="body" />
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <PrivateCheckbox t={t} id={`note-edit-private-${n.id}`} defaultChecked={n.visibility === "private"} />
                            <SubmitButton size="sm" variant="outline">
                              {t.common.save}
                            </SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                      <ActionForm action={deleteCaseNoteAction} showSuccess={false}>
                        <input type="hidden" name="noteId" value={n.id} />
                        <SubmitButton size="sm" variant="ghost">
                          {t.caseNotes.delete}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
