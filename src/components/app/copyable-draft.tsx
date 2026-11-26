"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * An editable draft the lawyer copies into their own email or messenger.
 * Nothing is sent or saved by DosarIA; edits live only in this page.
 */
export function CopyableDraft({
  id,
  label,
  text,
  lang,
  copyLabel,
  copiedLabel,
}: {
  id: string;
  label: string;
  text: string;
  lang: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const el = ref.current;
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.value);
    } catch {
      // Clipboard unavailable (e.g. permissions): select the text so the user can copy it.
      el.select();
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} ref={ref} defaultValue={text} lang={lang} rows={Math.min(14, text.split("\n").length + 1)} />
      <div>
        <Button type="button" size="sm" variant="outline" onClick={copy} aria-live="polite">
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  );
}
