import type { Metadata } from "next";
import {
  changeMemberRoleAction,
  changeMemberStatusAction,
  renameOrganizationAction,
  revokeInvitationAction,
} from "@/app/actions/organization";
import { ActionForm, FieldError, SubmitButton } from "@/components/app/action-form";
import { InviteForm } from "@/components/app/invite-form";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { RoleBadge } from "@/components/app/status-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { label } from "@/i18n";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { requireOrgPageContext } from "@/server/context";
import { listAuditLogs } from "@/server/dal/audit";
import { listInvitations, listMembers } from "@/server/dal/organizations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.settings };
}

export default async function SettingsPage() {
  const ctx = await requireOrgPageContext();
  const { t, locale } = ctx;
  const org = ctx.activeOrg;
  const isAdmin = org.role === "admin";
  const [members, invitations, audit] = await Promise.all([
    listMembers(ctx, org.organizationId),
    isAdmin ? listInvitations(ctx, org.organizationId) : Promise.resolve([]),
    isAdmin ? listAuditLogs(ctx, org.organizationId, 50) : Promise.resolve([]),
  ]);
  const nameOf = new Map(members.map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || "—"]));

  return (
    <div className="grid gap-6">
      <PageHeader title={isAdmin ? t.settings.titleAdmin : t.settings.titleMember} description={org.organizationName} />

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.nameTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={renameOrganizationAction} className="flex flex-wrap items-start gap-3">
              <div className="grid gap-1">
                <Input name="name" defaultValue={org.organizationName} className="w-80" aria-label={t.settings.nameAria} />
                <FieldError name="name" />
              </div>
              <SubmitButton variant="outline">{t.common.save}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.membersTitle}</CardTitle>
          <CardDescription>{t.settings.membersDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="members-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t.settings.colName}</TableHead>
                <TableHead>{t.settings.colRole}</TableHead>
                <TableHead>{t.settings.colStatus}</TableHead>
                {isAdmin && <TableHead className="text-right">{t.settings.colActions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="font-medium">{m.profiles?.full_name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{m.profiles?.email}</div>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={m.role} />
                  </TableCell>
                  <TableCell className="text-sm">{label(t.labels.memberStatus, m.status)}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      {m.user_id === ctx.user.id ? (
                        <span className="text-xs text-muted-foreground">{t.common.you}</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionForm action={changeMemberRoleAction} className="flex gap-1">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <NativeSelect name="role" defaultValue={m.role} size="sm" aria-label={t.settings.roleAria}>
                              {Object.entries(t.labels.roles).map(([v, l]) => (
                                <NativeSelectOption key={v} value={v}>
                                  {l}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <SubmitButton size="sm" variant="outline">
                              {t.settings.roleSubmit}
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm action={changeMemberStatusAction} className="flex gap-1">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <NativeSelect name="status" defaultValue={m.status} size="sm" aria-label={t.settings.statusAria}>
                              {Object.entries(t.labels.memberStatus).map(([v, l]) => (
                                <NativeSelectOption key={v} value={v}>
                                  {l}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <SubmitButton size="sm" variant="outline">
                              {t.settings.statusSubmit}
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.invitationsTitle}</CardTitle>
            <CardDescription>{t.settings.invitationsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <InviteForm />
            {invitations.length > 0 && (
              <ul className="divide-y rounded-md border text-sm">
                {invitations.map((i) => {
                  const pending = !i.accepted_at && !i.revoked_at && new Date(i.expires_at) >= new Date();
                  const state = i.accepted_at
                    ? t.settings.invitationAccepted
                    : i.revoked_at
                      ? t.settings.invitationRevoked
                      : pending
                        ? t.settings.invitationPending
                        : t.settings.invitationExpired;
                  return (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                      <span className="font-medium">{i.email}</span>
                      <RoleBadge role={i.role} />
                      <Badge variant="outline">{state}</Badge>
                      <span className="text-xs text-muted-foreground">{t.settings.expires(formatDateTime(i.expires_at, locale))}</span>
                      {pending && (
                        <ActionForm action={revokeInvitationAction} className="ml-auto">
                          <input type="hidden" name="invitationId" value={i.id} />
                          <SubmitButton size="sm" variant="ghost">
                            {t.settings.revoke}
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.auditTitle}</CardTitle>
            <CardDescription>{t.settings.auditDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState title={t.settings.auditEmpty} />
            ) : (
              <Table data-testid="audit-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.settings.colDate}</TableHead>
                    <TableHead>{t.settings.colActor}</TableHead>
                    <TableHead>{t.settings.colAction}</TableHead>
                    <TableHead>{t.settings.colResource}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(a.created_at, locale)}</TableCell>
                      <TableCell className="text-sm">
                        {a.actor_type === "system"
                          ? t.common.system
                          : (a.actor_user_id && nameOf.get(a.actor_user_id)) || t.common.user}
                      </TableCell>
                      <TableCell className="text-sm">{label(t.labels.audit, a.action)}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {a.resource_type}
                        {a.resource_id ? `:${a.resource_id.slice(0, 8)}` : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
