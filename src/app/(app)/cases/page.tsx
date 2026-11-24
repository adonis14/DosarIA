import Link from "next/link";
import { Plus } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { CaseStatusBadge, CheckOutcomeBadge } from "@/components/app/status-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { CASE_STATUS_LABELS, MATTER_TYPE_LABELS, label } from "@/lib/labels";
import { caseFiltersSchema } from "@/lib/validation";
import { requireOrgPageContext } from "@/server/context";
import { getAuthorizedCases } from "@/server/dal/cases";
import { listMembers } from "@/server/dal/organizations";

export const metadata = { title: "Dosare" };

export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const ctx = await requireOrgPageContext();
  const sp = await searchParams;
  const raw = {
    q: typeof sp.q === "string" ? sp.q : undefined,
    status: typeof sp.status === "string" ? sp.status : undefined,
    matterType: typeof sp.matterType === "string" ? sp.matterType : undefined,
    assignee: typeof sp.assignee === "string" ? sp.assignee : undefined,
  };
  const parsed = caseFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : caseFiltersSchema.parse({});

  const isAdmin = ctx.activeOrg.role === "admin";
  const [cases, members] = await Promise.all([
    getAuthorizedCases(ctx, filters),
    listMembers(ctx, ctx.activeOrg.organizationId),
  ]);
  const nameOf = new Map(members.map((m) => [m.user_id, m.profiles?.full_name || m.profiles?.email || "—"]));
  const lawyers = members.filter((m) => m.status === "active" && m.role !== "assistant");
  const canCreate = ctx.activeOrg.role !== "assistant";

  return (
    <>
      <PageHeader
        title="Dosare"
        description={isAdmin ? "Toate dosarele organizației." : "Dosarele alocate dumneavoastră."}
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/cases/new">
                <Plus aria-hidden />
                Adaugă dosar
              </Link>
            </Button>
          )
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="grid gap-1">
          <label htmlFor="q" className="text-xs text-muted-foreground">
            Căutare
          </label>
          <Input id="q" name="q" defaultValue={filters.q} placeholder="Număr, instanță, titlu" className="w-64" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            Stare
          </label>
          <NativeSelect id="status" name="status" defaultValue={filters.status}>
            <NativeSelectOption value="all">Toate</NativeSelectOption>
            {Object.entries(CASE_STATUS_LABELS).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <label htmlFor="matterType" className="text-xs text-muted-foreground">
            Materie
          </label>
          <NativeSelect id="matterType" name="matterType" defaultValue={filters.matterType}>
            <NativeSelectOption value="all">Toate</NativeSelectOption>
            {Object.entries(MATTER_TYPE_LABELS).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {isAdmin && (
          <div className="grid gap-1">
            <label htmlFor="assignee" className="text-xs text-muted-foreground">
              Avocat
            </label>
            <NativeSelect id="assignee" name="assignee" defaultValue={filters.assignee}>
              <NativeSelectOption value="all">Toți</NativeSelectOption>
              <NativeSelectOption value="me">Eu</NativeSelectOption>
              <NativeSelectOption value="unassigned">Nealocat</NativeSelectOption>
              {lawyers.map((m) => (
                <NativeSelectOption key={m.user_id} value={m.user_id}>
                  {nameOf.get(m.user_id)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
        <Button type="submit" variant="outline">
          Filtrează
        </Button>
      </form>

      {!parsed.success && (
        <Alert className="mb-4">
          <AlertDescription>Filtrele introduse nu sunt valide și au fost ignorate.</AlertDescription>
        </Alert>
      )}

      {cases.length === 0 ? (
        <EmptyState title="Niciun dosar găsit">
          {canCreate ? "Adăugați un dosar sau modificați filtrele." : "Nu aveți dosare alocate. Contactați un administrator."}
        </EmptyState>
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="cases-table">
            <TableHeader>
              <TableRow>
                <TableHead>Număr dosar</TableHead>
                <TableHead>Titlu / instanță</TableHead>
                <TableHead>Avocat</TableHead>
                <TableHead>Stare</TableHead>
                <TableHead>Ultima verificare</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-sm">
                    <Link href={`/cases/${c.id}`} className="hover:underline">
                      {c.court_case_number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-80">
                    <Link href={`/cases/${c.id}`} className="block truncate font-medium hover:underline">
                      {c.title}
                    </Link>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.court_name} · {label(MATTER_TYPE_LABELS, c.matter_type)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{c.assigned_user_id ? nameOf.get(c.assigned_user_id) ?? "—" : "Nealocat"}</TableCell>
                  <TableCell>
                    <CaseStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <CheckOutcomeBadge outcome={c.last_check_outcome} />
                      <span className="text-xs text-muted-foreground">{formatDateTime(c.last_check_attempt_at)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
