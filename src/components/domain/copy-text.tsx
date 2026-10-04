"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * A value shown as selectable text with a Copy button (a QR URL). Falls
 * back to selecting the text when the Clipboard API is unavailable (plain
 * http on a LAN iPad), so it can still be copied by hand.
 */
export function CopyText({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const id = `copy-${label.replace(/\W+/g, "-").toLowerCase()}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: "Copied", tone: "success" });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const node = document.getElementById(id);
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      toast({ title: "Select the text and copy it", tone: "neutral" });
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code
        id={id}
        aria-label={label}
        className="min-w-0 rounded-lg bg-sunken px-2 py-1 font-mono text-sm break-all select-all"
      >
        {value}
      </code>
      <Button variant="outline" size="sm" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
