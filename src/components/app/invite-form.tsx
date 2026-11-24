"use client";

import { inviteMemberAction } from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS } from "@/lib/labels";

export function InviteForm() {
  return (
    <ActionForm
      action={inviteMemberAction}
      className="grid gap-3"
      render={(state) =>
        state?.ok && state.data?.link ? (
          <div className="grid gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            <p className="font-medium">Link de invitație (afișat o singură dată, valabil până la {formatDateTime(state.data.expiresAt)}):</p>
            <code className="break-all text-xs" data-testid="invitation-link">
              {state.data.link}
            </code>
            <p className="text-xs">
              Transmiteți linkul printr-un canal de încredere. Poate fi acceptat doar de contul cu adresa de e-mail invitată,
              după confirmarea acesteia.
            </p>
          </div>
        ) : null
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="invite-email">E-mail</Label>
          <Input id="invite-email" name="email" type="email" required />
          <FieldError name="email" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite-role">Rol</Label>
          <NativeSelect id="invite-role" name="role" defaultValue="lawyer">
            {Object.entries(ROLE_LABELS).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <SubmitButton>Creează invitația</SubmitButton>
      </div>
    </ActionForm>
  );
}
