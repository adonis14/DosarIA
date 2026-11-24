import { FieldError } from "@/components/app/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CASE_STATUS_LABELS, MATTER_TYPE_LABELS } from "@/lib/labels";

export type CaseFormDefaults = {
  courtCaseNumber?: string;
  courtName?: string;
  title?: string;
  matterType?: string;
  status?: string;
};

/** Shared fields; rendered inside an <ActionForm>. */
export function CaseFields({ defaults = {}, withStatus = false }: { defaults?: CaseFormDefaults; withStatus?: boolean }) {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="courtCaseNumber">Număr dosar</Label>
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
        <Label htmlFor="courtName">Instanța</Label>
        <Input id="courtName" name="courtName" defaultValue={defaults.courtName} placeholder="Tribunalul București" required />
        <FieldError name="courtName" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="title">Titlu / obiect intern</Label>
        <Input id="title" name="title" defaultValue={defaults.title} placeholder="Pretenții — contract de furnizare" required />
        <p className="text-xs text-muted-foreground">Evitați datele personale ale clienților în titlu (minimizarea datelor).</p>
        <FieldError name="title" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="matterType">Materie</Label>
        <NativeSelect id="matterType" name="matterType" defaultValue={defaults.matterType ?? "civil"}>
          {Object.entries(MATTER_TYPE_LABELS).map(([v, l]) => (
            <NativeSelectOption key={v} value={v}>
              {l}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <FieldError name="matterType" />
      </div>
      {withStatus && (
        <div className="grid gap-2">
          <Label htmlFor="status">Stare</Label>
          <NativeSelect id="status" name="status" defaultValue={defaults.status ?? "active"}>
            {Object.entries(CASE_STATUS_LABELS).map(([v, l]) => (
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
