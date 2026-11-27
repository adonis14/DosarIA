import "server-only";
import { logServerError } from "@/lib/errors";
import { LIMITS, rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AuthContext } from "@/server/context";

/**
 * Security audit events observed by the application (e.g. an attempt to open
 * a case the caller may not access). Data-change auditing (case created,
 * assignment changed, reminder confirmed, ...) is done by database triggers.
 *
 * Writes use the privileged client because ordinary users have no INSERT
 * privilege on audit_logs. The entry shape is fixed here; callers cannot
 * pass arbitrary payloads, and per-actor rate limiting prevents log flooding.
 */
export type SecurityEvent = {
  action: `security.${string}`;
  resourceType: string;
  resourceId?: string | null;
  /** Only set when the organization is known to the caller (never echo another tenant's id). */
  organizationId?: string | null;
};

export async function logSecurityEvent(ctx: { user: Pick<AuthContext["user"], "id"> } | null, event: SecurityEvent): Promise<void> {
  const actorKey = ctx?.user.id ?? "anonymous";
  if (!rateLimit(`seclog:${actorKey}`, LIMITS.securityLogPerActor.limit, LIMITS.securityLogPerActor.windowMs).ok) {
    return;
  }
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("audit_logs").insert({
      organization_id: event.organizationId ?? null,
      actor_type: ctx ? "user" : "system",
      actor_user_id: ctx?.user.id ?? null,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId ?? null,
      metadata: {},
    });
    if (error) logServerError("logSecurityEvent", error);
  } catch (err) {
    // Audit logging must never break the request it describes.
    logServerError("logSecurityEvent", err);
  }
}

export type AuditEntry = {
  id: number;
  actor_type: "user" | "system";
  actor_user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Organization activity history. RLS returns rows only to admins of that organization. */
export async function listAuditLogs(ctx: AuthContext, organizationId: string, limit = 50): Promise<AuditEntry[]> {
  const { data, error } = await ctx.supabase
    .from("audit_logs")
    .select("id, actor_type, actor_user_id, action, resource_type, resource_id, metadata, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) {
    logServerError("listAuditLogs", error);
    return [];
  }
  return (data ?? []) as AuditEntry[];
}
