"use client";

import { createCalendarFeedAction } from "@/app/actions/calendar";
import { ActionForm, SubmitButton } from "@/components/app/action-form";
import { CopyableDraft } from "@/components/app/copyable-draft";
import { useI18n } from "@/i18n/client";

/** Creates (or replaces) the private calendar link and shows it once. */
export function CalendarLinkForm({ submitLabel }: { submitLabel: string }) {
  const { messages } = useI18n();
  return (
    <ActionForm
      action={createCalendarFeedAction}
      className="grid gap-3"
      showSuccess={false}
      render={(state) =>
        state?.ok && state.data?.url ? (
          <div
            className="grid gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"
            data-testid="calendar-link"
          >
            <CopyableDraft
              id="calendar-link-url"
              label={messages.calendarLinkHeading}
              text={state.data.url}
              lang="en"
              copyLabel={messages.copy}
              copiedLabel={messages.copied}
            />
            <p className="text-xs">{messages.calendarLinkHint}</p>
          </div>
        ) : null
      }
    >
      <div>
        <SubmitButton variant="outline" size="sm">
          {submitLabel}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
