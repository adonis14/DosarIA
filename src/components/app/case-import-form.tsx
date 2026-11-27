"use client";

import Link from "next/link";
import { useActionState, useState, type ChangeEvent } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { importCasesAction, previewCaseImportAction } from "@/app/actions/case-import";
import { SubmitButton } from "@/components/app/action-form";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { Dictionary } from "@/i18n";
import type { ActionResult } from "@/lib/errors";
import type { ImportOutcome, ImportPreview } from "@/lib/shared-types";

type Strings = Dictionary["caseImport"];
const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ""));

/**
 * Read a CSV file as text in the browser. Excel on Romanian Windows often
 * saves CSV in Windows-1250; if the file is not valid UTF-8, decode it so.
 */
async function readCsv(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1250").decode(bytes);
  }
}

export function CaseImportForm({
  s,
  unassignedLabel,
  isAdmin,
  assignees,
}: {
  s: Strings;
  unassignedLabel: string;
  isAdmin: boolean;
  assignees: { id: string; name: string }[];
}) {
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [preview, previewAction] = useActionState<ActionResult<ImportPreview> | null, FormData>(previewCaseImportAction, null);
  const [outcome, importAction] = useActionState<ActionResult<ImportOutcome> | null, FormData>(importCasesAction, null);
  const [previewed, setPreviewed] = useState<{ text: string; assignee: string } | null>(null);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 400_000) {
      setFileNote(s.parseErrors.too_large);
      return;
    }
    try {
      setText(await readCsv(file));
      setFileNote(fill(s.fileLoaded, { name: file.name }));
    } catch {
      setFileNote(s.fileError);
    }
  }

  const data = preview?.ok ? preview.data : undefined;
  const stale = previewed !== null && (previewed.text !== text || previewed.assignee !== assignee);
  const done = outcome?.ok ? outcome.data : undefined;

  if (done) {
    return (
      <div className="grid gap-4" data-testid="import-done">
        <p role="status" className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{fill(s.done, { imported: done.imported, skipped: done.skipped + done.failed.length })}</span>
        </p>
        {done.failed.length > 0 && (
          <div className="grid gap-2 text-sm">
            <p className="font-medium">{s.failedTitle}</p>
            <ul className="grid gap-1" data-testid="import-failed">
              {done.failed.map((f) => (
                <li key={f.line}>
                  {fill(s.rowRef, { line: f.line })} · <span className="font-mono">{f.courtCaseNumber}</span> — {f.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <Link href="/cases" className="text-sm font-medium underline-offset-4 hover:underline">
            {s.backToCases}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <form
        action={(fd) => {
          setPreviewed({ text, assignee });
          previewAction(fd);
        }}
        className="grid gap-4"
        noValidate
      >
        <div className="grid gap-2">
          <Label htmlFor="import-file">{s.file}</Label>
          <input id="import-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={onFile} className="text-sm" />
          <p className="text-xs text-muted-foreground">{fileNote ?? s.fileHint}</p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="import-data">{s.paste}</Label>
          <Textarea
            id="import-data"
            name="data"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={s.example}
            className="font-mono text-xs"
            spellCheck={false}
          />
        </div>
        {isAdmin ? (
          <div className="grid gap-2">
            <Label htmlFor="import-assignee">{s.defaultAssignee}</Label>
            <NativeSelect id="import-assignee" name="defaultAssigneeId" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <NativeSelectOption value="">{unassignedLabel}</NativeSelectOption>
              {assignees.map((a) => (
                <NativeSelectOption key={a.id} value={a.id}>
                  {a.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{s.lawyerSelf}</p>
        )}
        {preview && !preview.ok && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{preview.error}</span>
          </p>
        )}
        <div>
          <SubmitButton variant="outline">{s.preview}</SubmitButton>
        </div>
      </form>

      {data && (
        <section className="grid gap-4" aria-labelledby="import-preview-title" data-testid="import-preview">
          <h2 id="import-preview-title" className="text-lg font-semibold">
            {s.previewTitle}
          </h2>
          <p className="text-sm" data-testid="import-summary">
            {fill(s.previewSummary, { ready: data.ready, problems: data.problems })}
          </p>
          <div className="max-h-[28rem] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.colLine}</TableHead>
                  <TableHead>{s.colNumber}</TableHead>
                  <TableHead>{s.colCourt}</TableHead>
                  <TableHead>{s.colTitle}</TableHead>
                  <TableHead>{s.colMatter}</TableHead>
                  <TableHead>{s.colLawyer}</TableHead>
                  <TableHead>{s.colResult}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.line} data-testid="import-row" data-ready={r.ready}>
                    <TableCell className="text-xs text-muted-foreground">{r.line}</TableCell>
                    <TableCell className="font-mono text-xs">{r.courtCaseNumber || "—"}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">{r.courtName || "—"}</TableCell>
                    <TableCell className="max-w-48 truncate text-xs">
                      {r.title}
                      {r.titleDefaulted && <span className="text-muted-foreground"> ({s.titleDefaulted})</span>}
                    </TableCell>
                    <TableCell className="text-xs">{r.matter}</TableCell>
                    <TableCell className="text-xs">{r.assignee}</TableCell>
                    <TableCell className="text-xs">
                      {r.ready ? (
                        <Badge variant="secondary">{s.ready}</Badge>
                      ) : (
                        <ul className="grid gap-0.5 text-destructive">
                          {r.problems.map((p) => (
                            <li key={p}>{p}</li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {stale ? (
            <p className="text-sm text-muted-foreground">{s.stale}</p>
          ) : data.ready === 0 ? (
            <p className="text-sm text-muted-foreground">{s.nothingToImport}</p>
          ) : (
            <form action={importAction} className="grid gap-2">
              <input type="hidden" name="data" value={previewed?.text ?? ""} />
              <input type="hidden" name="defaultAssigneeId" value={previewed?.assignee ?? ""} />
              {outcome && !outcome.ok && (
                <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{outcome.error}</span>
                </p>
              )}
              <div>
                <SubmitButton pendingLabel={s.importing}>{fill(s.submit, { count: data.ready })}</SubmitButton>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
