"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";

/** Sanitized failure state: never renders error messages or stack traces. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { messages } = useI18n();
  return (
    <Alert variant="destructive" className="max-w-xl">
      <AlertTitle>{messages.appErrorTitle}</AlertTitle>
      <AlertDescription>
        <p>{messages.appErrorBody}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
          {messages.retry}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
