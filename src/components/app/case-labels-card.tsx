import Link from "next/link";
import { createLabelAction, setCaseLabelsAction } from "@/app/actions/labels-notes";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { CaseLabelBadge } from "@/components/app/case-label-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Dictionary } from "@/i18n";
import { LABEL_COLORS } from "@/lib/validation";
import type { LabelRow } from "@/lib/shared-types";

export function LabelColorSelect({ t, id, defaultValue = "gray" }: { t: Dictionary; id: string; defaultValue?: string }) {
  return (
    <NativeSelect id={id} name="color" defaultValue={defaultValue}>
      {LABEL_COLORS.map((c) => (
        <NativeSelectOption key={c} value={c}>
          {t.caseLabels.colors[c]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Labels on one case: shown to every reader, changed by whoever can edit the case. */
export function CaseLabelsCard({
  t,
  caseId,
  labels,
  assigned,
  canEdit,
  canCreate,
}: {
  t: Dictionary;
  caseId: string;
  labels: LabelRow[];
  assigned: string[];
  canEdit: boolean;
  canCreate: boolean;
}) {
  const current = labels.filter((l) => assigned.includes(l.id));
  return (
    <Card data-testid="case-labels">
      <CardHeader>
        <CardTitle>{t.caseLabels.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {current.length === 0 ? (
          <p className="text-muted-foreground">{t.caseLabels.none}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="case-labels-current">
            {current.map((l) => (
              <CaseLabelBadge key={l.id} name={l.name} color={l.color} />
            ))}
          </div>
        )}

        {canEdit && labels.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">{t.caseLabels.change}</summary>
            <ActionForm action={setCaseLabelsAction} className="mt-3 grid gap-3">
              <input type="hidden" name="caseId" value={caseId} />
              <fieldset className="grid gap-2">
                <legend className="sr-only">{t.caseLabels.title}</legend>
                {labels.map((l) => (
                  <label key={l.id} className="flex items-center gap-2">
                    <input type="checkbox" name="labelId" value={l.id} defaultChecked={assigned.includes(l.id)} className="size-4" />
                    <CaseLabelBadge name={l.name} color={l.color} />
                  </label>
                ))}
              </fieldset>
              <div>
                <SubmitButton variant="outline" size="sm">
                  {t.caseLabels.save}
                </SubmitButton>
              </div>
            </ActionForm>
          </details>
        )}

        {canEdit && canCreate && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">{t.caseLabels.newLabel}</summary>
            <ActionForm action={createLabelAction} className="mt-3 grid gap-3">
              <input type="hidden" name="caseId" value={caseId} />
              <div className="grid gap-1.5">
                <Label htmlFor="new-label-name">{t.caseLabels.name}</Label>
                <Input id="new-label-name" name="name" maxLength={40} required placeholder={t.caseLabels.namePlaceholder} />
                <FieldError name="name" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="new-label-color">{t.caseLabels.color}</Label>
                <LabelColorSelect t={t} id="new-label-color" />
              </div>
              <div>
                <SubmitButton variant="outline" size="sm">
                  {t.caseLabels.createAndAdd}
                </SubmitButton>
              </div>
            </ActionForm>
          </details>
        )}

        {!canEdit && <p className="text-xs text-muted-foreground">{t.caseLabels.readOnly}</p>}
        <Link href="/cases/labels" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
          {t.caseLabels.manage}
        </Link>
      </CardContent>
    </Card>
  );
}
