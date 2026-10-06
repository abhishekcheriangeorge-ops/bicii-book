"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";

/**
 * A stored webhook payload (admins only, D86): pretty JSON in a dense
 * monospace block. Long lines scroll sideways inside the block only, never
 * the page; "Wrap lines" wraps them instead. The block is capped at 60% of
 * the viewport until "Show all"; Copy puts the JSON on the clipboard.
 */
export function JsonView({ json, label = "Payload" }: { json: string; label?: string }) {
  const { toast } = useToast();
  const id = useId();
  const [wrap, setWrap] = useState(false);
  const [all, setAll] = useState(false);
  const lines = json.split("\n").length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast({ title: "Copied", tone: "success" });
    } catch {
      toast({ title: "Select the text and copy it", tone: "neutral" });
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={wrap}
          aria-controls={id}
          onClick={() => setWrap((w) => !w)}
        >
          {wrap ? "Don't wrap" : "Wrap lines"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          Copy
        </Button>
        <span className="text-sm text-dust-500 tabular-nums">
          {lines} {lines === 1 ? "line" : "lines"}
        </span>
      </div>
      <pre
        id={id}
        aria-label={label}
        tabIndex={0}
        data-wrap={wrap ? "true" : "false"}
        data-expanded={all ? "true" : "false"}
        className={cn(
          "max-w-full overflow-auto rounded-xl bg-sunken p-3 font-mono text-xs leading-5",
          wrap ? "break-words whitespace-pre-wrap" : "whitespace-pre",
          all ? "" : "max-h-[60vh]",
        )}
      >
        {json}
      </pre>
      {!all ? (
        <div>
          <Button variant="ghost" size="sm" aria-controls={id} onClick={() => setAll(true)}>
            Show all
          </Button>
        </div>
      ) : null}
    </div>
  );
}
