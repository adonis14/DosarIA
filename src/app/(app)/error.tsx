"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Sanitized failure state: never renders error messages or stack traces. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Alert variant="destructive" className="max-w-xl">
      <AlertTitle>Pagina nu a putut fi încărcată</AlertTitle>
      <AlertDescription>
        <p>A apărut o eroare. Încercați din nou; dacă problema persistă, contactați administratorul.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={reset}>
          Reîncearcă
        </Button>
      </AlertDescription>
    </Alert>
  );
}
