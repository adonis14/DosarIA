import "server-only";
import { logServerError } from "@/lib/errors";
import type { AuthContext } from "@/server/context";

export type DashboardStats = {
  totalCases: number;
  casesNeedingAttention: { id: string; court_case_number: string; title: string; last_check_outcome: string }[];
  remindersNeedingReview: number;
  proposedReminders: number;
  monitoring: Record<string, number>;
};

/** Every count is computed through RLS: users only count what they may see. */
export async function getDashboardStats(ctx: AuthContext): Promise<DashboardStats> {
  const empty: DashboardStats = {
    totalCases: 0,
    casesNeedingAttention: [],
    remindersNeedingReview: 0,
    proposedReminders: 0,
    monitoring: {},
  };
  if (!ctx.activeOrg) return empty;
  const orgId = ctx.activeOrg.organizationId;

  const [cases, attention, needsReview, proposed] = await Promise.all([
    ctx.supabase.from("cases").select("last_check_outcome").eq("organization_id", orgId).neq("status", "archived"),
    ctx.supabase
      .from("cases")
      .select("id, court_case_number, title, last_check_outcome")
      .eq("organization_id", orgId)
      .neq("status", "archived")
      .in("last_check_outcome", ["failed", "incomplete", "source_unavailable"])
      .order("last_check_attempt_at", { ascending: false })
      .limit(10),
    ctx.supabase
      .from("deadline_reminders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "needs_review"),
    ctx.supabase
      .from("deadline_reminders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "proposed"),
  ]);

  for (const r of [cases, attention, needsReview, proposed]) {
    if (r.error) logServerError("getDashboardStats", r.error);
  }

  const monitoring: Record<string, number> = {};
  for (const row of cases.data ?? []) {
    monitoring[row.last_check_outcome] = (monitoring[row.last_check_outcome] ?? 0) + 1;
  }

  return {
    totalCases: cases.data?.length ?? 0,
    casesNeedingAttention: attention.data ?? [],
    remindersNeedingReview: needsReview.count ?? 0,
    proposedReminders: proposed.count ?? 0,
    monitoring,
  };
}
