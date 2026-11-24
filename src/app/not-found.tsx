import Link from "next/link";

/**
 * Shown both for unknown ids and for records the user may not access, so a
 * response never confirms that another firm's (or colleague's) case exists.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Resursa nu a fost găsită</h1>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="not-found">
        Pagina nu există sau nu aveți acces la ea.
      </p>
      <Link href="/dashboard" className="mt-6 inline-block text-sm underline-offset-4 hover:underline">
        Înapoi la panou
      </Link>
    </main>
  );
}
