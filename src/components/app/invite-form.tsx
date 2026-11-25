"use client";

import { inviteMemberAction } from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { interpolate } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { formatDateTime } from "@/lib/format";

export function InviteForm() {
  const { locale, messages, roles } = useI18n();
  return (
    <ActionForm
      action={inviteMemberAction}
      className="grid gap-3"
      render={(state) =>
        state?.ok && state.data?.link ? (
          <div className="grid gap-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            <p className="font-medium">
              {interpolate(messages.inviteLinkHeading, { date: formatDateTime(state.data.expiresAt, locale) })}
            </p>
            <code className="break-all text-xs" data-testid="invitation-link">
              {state.data.link}
            </code>
            <p className="text-xs">{messages.inviteLinkHint}</p>
          </div>
        ) : null
      }
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="invite-email">{messages.inviteEmail}</Label>
          <Input id="invite-email" name="email" type="email" required />
          <FieldError name="email" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="invite-role">{messages.inviteRole}</Label>
          <NativeSelect id="invite-role" name="role" defaultValue="lawyer">
            {Object.entries(roles).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <SubmitButton>{messages.inviteSubmit}</SubmitButton>
      </div>
    </ActionForm>
  );
}
