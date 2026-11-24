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
import { formatDateTime } from "@/lib/format";
import { MEMBER_STATUS_LABELS, ROLE_LABELS, label } from "@/lib/labels";
import { requireOrgPageContext } from "@/server/context";
import { listAuditLogs } from "@/server/dal/audit";
import { listInvitations, listMembers } from "@/server/dal/organizations";

export const metadata = { title: "Organizație" };

const AUDIT_LABELS: Record<string, string> = {
  "organization.created": "Organizație creată",
  "organization.renamed": "Organizație redenumită",
  "member.added": "Membru adăugat",
  "member.role_changed": "Rol modificat",
  "member.status_changed": "Statut membru modificat",
  "invitation.created": "Invitație creată",
  "invitation.accepted": "Invitație acceptată",
  "invitation.revoked": "Invitație revocată",
  "case.created": "Dosar creat",
  "case.updated": "Dosar actualizat",
  "case.assignment_changed": "Alocare modificată",
  "case.status_changed": "Stare dosar modificată",
  "case.archived": "Dosar arhivat",
  "reminder.created": "Termen creat",
  "reminder.updated": "Termen modificat",
  "reminder.confirmed": "Termen confirmat",
  "reminder.completed": "Termen finalizat",
  "reminder.status_changed": "Stare termen modificată",
  "reminder.deleted": "Termen șters",
  "monitoring.run_completed": "Verificare monitorizare",
  "security.case_access_denied": "Acces refuzat la dosar",
  "security.assignment_denied": "Alocare refuzată",
  "security.role_change_denied": "Schimbare de rol refuzată",
};

export default async function SettingsPage() {
  const ctx = await requireOrgPageContext();
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
      <PageHeader title={isAdmin ? "Setările organizației" : "Echipa"} description={org.organizationName} />

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Denumire</CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={renameOrganizationAction} className="flex flex-wrap items-start gap-3">
              <div className="grid gap-1">
                <Input name="name" defaultValue={org.organizationName} className="w-80" aria-label="Denumirea organizației" />
                <FieldError name="name" />
              </div>
              <SubmitButton variant="outline">Salvează</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Membri</CardTitle>
          <CardDescription>Rolurile sunt gestionate exclusiv de administratori și verificate în baza de date.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="members-table">
            <TableHeader>
              <TableRow>
                <TableHead>Nume</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Statut</TableHead>
                {isAdmin && <TableHead className="text-right">Acțiuni</TableHead>}
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
                  <TableCell className="text-sm">{label(MEMBER_STATUS_LABELS, m.status)}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      {m.user_id === ctx.user.id ? (
                        <span className="text-xs text-muted-foreground">(dumneavoastră)</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-2">
                          <ActionForm action={changeMemberRoleAction} className="flex gap-1">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <NativeSelect name="role" defaultValue={m.role} size="sm" aria-label="Rol">
                              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                                <NativeSelectOption key={v} value={v}>
                                  {l}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <SubmitButton size="sm" variant="outline">
                              Rol
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm action={changeMemberStatusAction} className="flex gap-1">
                            <input type="hidden" name="membershipId" value={m.id} />
                            <NativeSelect name="status" defaultValue={m.status} size="sm" aria-label="Statut">
                              {Object.entries(MEMBER_STATUS_LABELS).map(([v, l]) => (
                                <NativeSelectOption key={v} value={v}>
                                  {l}
                                </NativeSelectOption>
                              ))}
                            </NativeSelect>
                            <SubmitButton size="sm" variant="outline">
                              Statut
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
            <CardTitle>Invitații</CardTitle>
            <CardDescription>
              Invitațiile expiră după 72 de ore, pot fi folosite o singură dată și doar de contul cu adresa invitată, confirmată.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <InviteForm />
            {invitations.length > 0 && (
              <ul className="divide-y rounded-md border text-sm">
                {invitations.map((i) => {
                  const state = i.accepted_at
                    ? "Acceptată"
                    : i.revoked_at
                      ? "Revocată"
                      : new Date(i.expires_at) < new Date()
                        ? "Expirată"
                        : "În așteptare";
                  return (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 p-3">
                      <span className="font-medium">{i.email}</span>
                      <RoleBadge role={i.role} />
                      <Badge variant="outline">{state}</Badge>
                      <span className="text-xs text-muted-foreground">expiră {formatDateTime(i.expires_at)}</span>
                      {state === "În așteptare" && (
                        <ActionForm action={revokeInvitationAction} className="ml-auto">
                          <input type="hidden" name="invitationId" value={i.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Revocă
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
            <CardTitle>Istoric activitate (audit)</CardTitle>
            <CardDescription>Ultimele 50 de evenimente. Jurnalul nu poate fi modificat sau șters de utilizatori.</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState title="Niciun eveniment" />
            ) : (
              <Table data-testid="audit-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Acțiune</TableHead>
                    <TableHead>Resursă</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(a.created_at)}</TableCell>
                      <TableCell className="text-sm">
                        {a.actor_type === "system" ? "Sistem" : (a.actor_user_id && nameOf.get(a.actor_user_id)) || "Utilizator"}
                      </TableCell>
                      <TableCell className="text-sm">{AUDIT_LABELS[a.action] ?? a.action}</TableCell>
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
