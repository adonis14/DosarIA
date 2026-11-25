import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Clock, Sparkles, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { label } from "@/i18n";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";

const tone = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  danger: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
};

export async function CheckOutcomeBadge({ outcome, className }: { outcome: string; className?: string }) {
  const map: Record<string, { t: keyof typeof tone; Icon: typeof Clock }> = {
    never_checked: { t: "neutral", Icon: CircleDashed },
    changes_detected: { t: "info", Icon: Sparkles },
    no_changes: { t: "success", Icon: CheckCircle2 },
    failed: { t: "danger", Icon: XCircle },
    incomplete: { t: "warning", Icon: AlertTriangle },
    source_unavailable: { t: "danger", Icon: CircleSlash },
  };
  const { t: toneKey, Icon } = map[outcome] ?? map.never_checked;
  const t = await getT();
  return (
    <Badge variant="outline" className={cn(tone[toneKey], className)}>
      <Icon aria-hidden />
      {label(t.labels.checkOutcome, outcome)}
    </Badge>
  );
}

export async function ReminderStatusBadge({ status }: { status: string }) {
  const t = await getT();
  const toneKey: keyof typeof tone =
    status === "confirmed" ? "success" : status === "needs_review" ? "warning" : status === "completed" ? "neutral" : "info";
  return (
    <Badge variant="outline" className={tone[toneKey]}>
      {label(t.labels.reminderStatus, status)}
    </Badge>
  );
}

export async function ReminderOriginBadge({ origin }: { origin: string }) {
  const t = await getT();
  return (
    <Badge variant="outline" className={origin === "suggested" ? tone.warning : tone.neutral}>
      {label(t.labels.reminderOrigin, origin)}
    </Badge>
  );
}

export async function CaseStatusBadge({ status }: { status: string }) {
  const t = await getT();
  const toneKey: keyof typeof tone = status === "active" ? "success" : "neutral";
  return (
    <Badge variant="outline" className={tone[toneKey]}>
      {label(t.labels.caseStatus, status)}
    </Badge>
  );
}

export async function RoleBadge({ role }: { role: string }) {
  const t = await getT();
  return (
    <Badge variant="outline" className={role === "admin" ? tone.info : tone.neutral}>
      {label(t.labels.roles, role)}
    </Badge>
  );
}
