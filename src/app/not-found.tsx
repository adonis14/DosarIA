import Link from "next/link";
import { getT } from "@/i18n/server";

/**
 * Shown both for unknown ids and for records the user may not access, so a
 * response never confirms that another firm's (or colleague's) case exists.
 */
export default async function NotFound() {
  const t = await getT();
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">{t.notFound.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="not-found">
        {t.notFound.description}
      </p>
      <Link href="/dashboard" className="mt-6 inline-block text-sm underline-offset-4 hover:underline">
        {t.notFound.back}
      </Link>
    </main>
  );
}
