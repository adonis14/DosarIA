import { Scale } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Scale className="size-5" aria-hidden />
        DosarIA
      </div>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
        Instrument de sprijin pentru monitorizarea dosarelor. Nu oferă consultanță juridică; avocatul rămâne responsabil
        pentru verificarea termenelor.
      </p>
    </main>
  );
}
