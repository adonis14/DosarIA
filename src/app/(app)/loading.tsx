import { Loader2 } from "lucide-react";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const t = await getT();
  return (
    <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t.common.loading}
    </div>
  );
}
