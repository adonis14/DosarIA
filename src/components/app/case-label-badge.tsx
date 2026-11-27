import { cn } from "@/lib/utils";
import type { LabelColor } from "@/lib/shared-types";

/** Fixed palette (no user-supplied CSS). Text keeps AA contrast in both themes. */
const COLOR_CLASSES: Record<LabelColor, string> = {
  gray: "border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100",
  red: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
  orange: "border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200",
  yellow: "border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
  green: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  blue: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  purple: "border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200",
  pink: "border-pink-300 bg-pink-50 text-pink-800 dark:border-pink-800 dark:bg-pink-950 dark:text-pink-200",
};

export function CaseLabelBadge({ name, color, className }: { name: string; color: LabelColor; className?: string }) {
  return (
    <span
      data-testid="case-label"
      className={cn(
        "inline-flex h-5 max-w-48 items-center truncate rounded-full border px-2 text-xs font-medium",
        COLOR_CLASSES[color] ?? COLOR_CLASSES.gray,
        className,
      )}
    >
      {name}
    </span>
  );
}
