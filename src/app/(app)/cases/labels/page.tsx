import type { Metadata } from "next";
import Link from "next/link";
import { createLabelAction, deleteLabelAction, updateLabelAction } from "@/app/actions/labels-notes";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { CaseLabelBadge } from "@/components/app/case-label-badge";
import { LabelColorSelect } from "@/components/app/case-labels-card";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getT } from "@/i18n/server";
import { requireOrgPageContext } from "@/server/context";
import { canCreateLabels, canManageLabel, listLabels } from "@/server/dal/labels";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.labels };
}

export default async function LabelsPage() {
  const ctx = await requireOrgPageContext();
  const { t } = ctx;
  const orgId = ctx.activeOrg.organizationId;
  const labels = await listLabels(ctx, orgId);
  const canCreate = canCreateLabels(ctx, orgId);

  return (
    <div className="grid max-w-3xl gap-6">
      <PageHeader title={t.caseLabels.manageTitle} description={t.caseLabels.manageDescription} />

      {canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>{t.caseLabels.newLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={createLabelAction} className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="label-name">{t.caseLabels.name}</Label>
                <Input id="label-name" name="name" maxLength={40} required placeholder={t.caseLabels.namePlaceholder} className="w-56" />
                <FieldError name="name" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="label-color">{t.caseLabels.color}</Label>
                <LabelColorSelect t={t} id="label-color" />
              </div>
              <SubmitButton>{t.caseLabels.create}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      {labels.length === 0 ? (
        <EmptyState title={t.caseLabels.noLabelsYet}>{canCreate ? t.caseLabels.noLabelsCanCreate : t.caseLabels.noLabelsAsk}</EmptyState>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t.caseLabels.listTitle}</CardTitle>
            <CardDescription>{t.caseLabels.deleteHint}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3" data-testid="labels-list">
              {labels.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 border-b pb-3 last:border-b-0 last:pb-0">
                  <Link href={`/cases?label=${l.id}&status=all`} className="min-w-32">
                    <CaseLabelBadge name={l.name} color={l.color} />
                  </Link>
                  {canManageLabel(ctx, orgId, l) && (
                    <>
                      <ActionForm action={updateLabelAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="labelId" value={l.id} />
                        <Label htmlFor={`name-${l.id}`} className="sr-only">
                          {t.caseLabels.name}
                        </Label>
                        <Input id={`name-${l.id}`} name="name" defaultValue={l.name} maxLength={40} required className="h-8 w-44" />
                        <Label htmlFor={`color-${l.id}`} className="sr-only">
                          {t.caseLabels.color}
                        </Label>
                        <LabelColorSelect t={t} id={`color-${l.id}`} defaultValue={l.color} />
                        <SubmitButton size="sm" variant="outline">
                          {t.common.save}
                        </SubmitButton>
                      </ActionForm>
                      <details>
                        <summary className="cursor-pointer text-xs text-destructive">{t.caseLabels.delete}</summary>
                        <ActionForm action={deleteLabelAction} className="mt-2 grid gap-2">
                          <input type="hidden" name="labelId" value={l.id} />
                          <p className="text-xs text-muted-foreground">{t.caseLabels.deleteConfirm}</p>
                          <SubmitButton size="sm" variant="destructive">
                            {t.caseLabels.deleteNow}
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
