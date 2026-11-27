import type { Metadata } from "next";
import { CaseImportForm } from "@/components/app/case-import-form";
import { PageHeader } from "@/components/app/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/i18n/server";
import { IMPORT_MAX_ROWS } from "@/lib/case-import";
import { requireOrgPageContext } from "@/server/context";
import { listMembers } from "@/server/dal/organizations";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).meta.caseImport };
}

export default async function CaseImportPage() {
  const ctx = await requireOrgPageContext();
  const { t } = ctx;
  const role = ctx.activeOrg.role;
  const s = t.caseImport;

  if (role === "assistant") {
    return (
      <>
        <PageHeader title={s.title} />
        <Alert>
          <AlertDescription>{t.newCase.assistantDenied}</AlertDescription>
        </Alert>
      </>
    );
  }

  const isAdmin = role === "admin";
  const members = isAdmin ? await listMembers(ctx, ctx.activeOrg.organizationId) : [];
  const assignees = members
    .filter((m) => m.status === "active" && m.role !== "assistant")
    .map((m) => ({ id: m.user_id, name: m.profiles?.full_name || m.profiles?.email || "—" }));

  return (
    <div className="grid max-w-5xl gap-6">
      <PageHeader title={s.title} description={s.description.replace("{max}", String(IMPORT_MAX_ROWS))} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <CaseImportForm s={s} unassignedLabel={t.common.unassignedOption} isAdmin={isAdmin} assignees={assignees} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{s.columnsTitle}</CardTitle>
            <CardDescription>{s.columnsHint}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <ul className="grid list-disc gap-1.5 pl-5">
              <li>{s.columns.number}</li>
              <li>{s.columns.court}</li>
              <li>{s.columns.title}</li>
              <li>{s.columns.matter}</li>
              {isAdmin && <li>{s.columns.lawyer}</li>}
            </ul>
            <div className="grid gap-1">
              <p className="font-medium">{s.exampleTitle}</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{s.example}</pre>
            </div>
            <ol className="grid list-decimal gap-1.5 pl-5 text-muted-foreground">
              <li>{s.how1}</li>
              <li>{s.how2}</li>
              <li>{s.how3}</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
