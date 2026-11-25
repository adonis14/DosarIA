import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { CourtText } from "@/components/app/court-text";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { CaseStatusBadge, CheckOutcomeBadge } from "@/components/app/status-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { label } from "@/i18n";
import { getT } from "@/i18n/server";
import { formatDateTime } from "@/lib/format";
import { caseFiltersSchema } from "@/lib/validation";
import { requireOrgPageContext } from "@/server/context";
import { getAuthorizedCases } from "@/server/dal/cases";
import { listMembers } from "@/server/dal/organizations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.cases };
}

export default async function CasesPage({ searchParams }: PageProps<"/cases">) {
  const ctx = await requireOrgPageContext();
  const { t, locale } = ctx;
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
        title={t.cases.title}
        description={isAdmin ? t.cases.descriptionAdmin : t.cases.descriptionLawyer}
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/cases/new">
                <Plus aria-hidden />
                {t.cases.add}
              </Link>
            </Button>
          )
        }
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="grid gap-1">
          <label htmlFor="q" className="text-xs text-muted-foreground">
            {t.cases.search}
          </label>
          <Input id="q" name="q" defaultValue={filters.q} placeholder={t.cases.searchPlaceholder} className="w-64" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="status" className="text-xs text-muted-foreground">
            {t.cases.status}
          </label>
          <NativeSelect id="status" name="status" defaultValue={filters.status}>
            <NativeSelectOption value="all">{t.common.all}</NativeSelectOption>
            {Object.entries(t.labels.caseStatus).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <label htmlFor="matterType" className="text-xs text-muted-foreground">
            {t.cases.matterType}
          </label>
          <NativeSelect id="matterType" name="matterType" defaultValue={filters.matterType}>
            <NativeSelectOption value="all">{t.common.all}</NativeSelectOption>
            {Object.entries(t.labels.matterType).map(([v, l]) => (
              <NativeSelectOption key={v} value={v}>
                {l}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {isAdmin && (
          <div className="grid gap-1">
            <label htmlFor="assignee" className="text-xs text-muted-foreground">
              {t.cases.lawyer}
            </label>
            <NativeSelect id="assignee" name="assignee" defaultValue={filters.assignee}>
              <NativeSelectOption value="all">{t.cases.allPeople}</NativeSelectOption>
              <NativeSelectOption value="me">{t.cases.me}</NativeSelectOption>
              <NativeSelectOption value="unassigned">{t.common.unassigned}</NativeSelectOption>
              {lawyers.map((m) => (
                <NativeSelectOption key={m.user_id} value={m.user_id}>
                  {nameOf.get(m.user_id)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
        <Button type="submit" variant="outline">
          {t.cases.filter}
        </Button>
      </form>

      {!parsed.success && (
        <Alert className="mb-4">
          <AlertDescription>{t.cases.invalidFilters}</AlertDescription>
        </Alert>
      )}

      {cases.length === 0 ? (
        <EmptyState title={t.cases.empty}>{canCreate ? t.cases.emptyCanCreate : t.cases.emptyCannotCreate}</EmptyState>
      ) : (
        <div className="rounded-lg border">
          <Table data-testid="cases-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t.cases.colNumber}</TableHead>
                <TableHead>{t.cases.colTitle}</TableHead>
                <TableHead>{t.cases.colLawyer}</TableHead>
                <TableHead>{t.cases.colStatus}</TableHead>
                <TableHead>{t.cases.colLastCheck}</TableHead>
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
                      <CourtText value={c.court_name} kind="court" /> · {label(t.labels.matterType, c.matter_type)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {c.assigned_user_id ? (nameOf.get(c.assigned_user_id) ?? "—") : t.common.unassigned}
                  </TableCell>
                  <TableCell>
                    <CaseStatusBadge status={c.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <CheckOutcomeBadge outcome={c.last_check_outcome} />
                      <span className="text-xs text-muted-foreground">{formatDateTime(c.last_check_attempt_at, locale)}</span>
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
