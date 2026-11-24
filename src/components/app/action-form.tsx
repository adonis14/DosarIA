"use client";

import { createContext, useActionState, useContext, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = ActionResult<any> | null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Action = (prev: any, formData: FormData) => Promise<AnyResult>;

const StateContext = createContext<AnyResult>(null);

/** Form bound to a Server Action, with inline error / success feedback. */
export function ActionForm({
  action,
  children,
  className,
  showSuccess = true,
  render,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  showSuccess?: boolean;
  /** Optional renderer for successful results (e.g. a one-time invitation link). */
  render?: (state: AnyResult) => ReactNode;
}) {
  const [state, formAction] = useActionState<AnyResult, FormData>(action, null);
  return (
    <StateContext.Provider value={state}>
      <form action={formAction} className={className} noValidate>
        {children}
        {state && !state.ok && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{state.error}</span>
          </p>
        )}
        {state?.ok && showSuccess && state.message && (
          <p role="status" className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{state.message}</span>
          </p>
        )}
        {render?.(state)}
      </form>
    </StateContext.Provider>
  );
}

export function FieldError({ name }: { name: string }) {
  const state = useContext(StateContext);
  const errors = state && !state.ok ? state.fieldErrors?.[name] : undefined;
  if (!errors?.length) return null;
  return (
    <p className="text-xs text-destructive" id={`${name}-error`}>
      {errors[0]}
    </p>
  );
}

export function SubmitButton({
  children,
  variant,
  size,
  className,
  pendingLabel,
}: {
  children: ReactNode;
  variant?: "default" | "outline" | "secondary" | "destructive" | "ghost";
  size?: "default" | "sm" | "lg";
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={cn(className)} aria-busy={pending}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
