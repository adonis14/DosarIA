import { FieldError } from "@/components/app/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { getT } from "@/i18n/server";

export type CaseFormDefaults = {
  courtCaseNumber?: string;
  courtName?: string;
  title?: string;
  matterType?: string;
  status?: string;
};

/** Shared fields; rendered inside an <ActionForm>. */
export async function CaseFields({ defaults = {}, withStatus = false }: { defaults?: CaseFormDefaults; withStatus?: boolean }) {
  const t = await getT();
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="courtCaseNumber">{t.caseForm.number}</Label>
        <Input
          id="courtCaseNumber"
          name="courtCaseNumber"
          defaultValue={defaults.courtCaseNumber}
          placeholder="1234/3/2026"
          className="font-mono"
          required
        />
        <FieldError name="courtCaseNumber" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="courtName">{t.caseForm.court}</Label>
        <Input
          id="courtName"
          name="courtName"
          defaultValue={defaults.courtName}
          placeholder="Tribunalul București"
          lang="ro"
          required
        />
        <p className="text-xs text-muted-foreground">{t.caseForm.courtHint}</p>
        <FieldError name="courtName" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="title">{t.caseForm.title}</Label>
        <Input id="title" name="title" defaultValue={defaults.title} placeholder={t.caseForm.titlePlaceholder} required />
        <p className="text-xs text-muted-foreground">{t.caseForm.titleHint}</p>
        <FieldError name="title" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="matterType">{t.caseForm.matterType}</Label>
        <NativeSelect id="matterType" name="matterType" defaultValue={defaults.matterType ?? "civil"}>
          {Object.entries(t.labels.matterType).map(([v, l]) => (
            <NativeSelectOption key={v} value={v}>
              {l}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldError name="matterType" />
      </div>
      {withStatus && (
        <div className="grid gap-2">
          <Label htmlFor="status">{t.caseForm.status}</Label>
          <NativeSelect id="status" name="status" defaultValue={defaults.status ?? "active"}>
            {Object.entries(t.labels.caseStatus).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError name="status" />
        </div>
      )}
    </>
  );
}
