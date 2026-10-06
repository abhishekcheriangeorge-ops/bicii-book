"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import {
  dismissJobAction,
  linkVariantAction,
  retryJobAction,
  searchProductsForLinkAction,
} from "@/app/(staff)/shopify/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SearchPicker, type PickerOption } from "@/components/ui/search-picker";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { QueueRow } from "@/lib/domain/shopify";
import { REASON_MAX_LENGTH } from "@/lib/reasons";
import { unmappedLineTitle, type UnmappedLine } from "@/lib/shopify";

import { ReasonConfirm } from "../reason-confirm";

/** What a job panel needs (a QueueRow; the event inspector passes its job). */
export type JobPanelJob = Pick<
  QueueRow,
  "id" | "kind" | "topic" | "status" | "eventId" | "unmappedLines" | "code"
>;

/**
 * What staff can do with one queue item (SPEC §26; D82, D84, D86, D87),
 * on the queue's sheet and in the event inspector:
 *
 *   - Retry: one tap, pending state; the toast says the outcome ("Recorded
 *     as S-000123") or the new human reason.
 *   - For an unmapped variant: "Link to a BICII product" per line that has
 *     a Shopify variant, opening the link form (the product SearchPicker,
 *     never a giant dropdown, SPEC §22; a required reason; then retry). A
 *     custom line (no variant) cannot be linked: record it by hand if
 *     needed, then dismiss.
 *   - Dismiss…: a two-step confirm with a required reason (ReasonConfirm:
 *     focus in the reason, the confirm button elsewhere, a 400 ms guard).
 *     Dismissing an order closes its waiting refunds too.
 *   - Open event (from the queue).
 *
 * `inSheet`: the link form replaces the actions inside the queue's sheet
 * (no sheet on a sheet); elsewhere it opens in its own LinkVariantSheet.
 */
export function JobPanel({
  job,
  inSheet = false,
  showOpenEvent = false,
  onDone,
}: {
  job: JobPanelJob;
  inSheet?: boolean;
  showOpenEvent?: boolean;
  /** After a dismiss, or a link or retry that closed the item. */
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const [retrying, startRetry] = useTransition();
  const [linking, setLinking] = useState<UnmappedLine | null>(null);
  const [confirming, setConfirming] = useState(false);
  const open = job.status === "needs_attention" || job.status === "queued";
  const isOrder = job.kind === "shopify_event" && job.topic === "orders/paid";

  const retry = () =>
    startRetry(async () => {
      const result = await retryJobAction({ jobId: job.id });
      if (!result.ok) {
        toast({ title: "Not retried", description: result.error, tone: "error" });
        return;
      }
      toast({
        title: result.data.title,
        description: result.data.description ?? undefined,
        tone: result.data.tone,
      });
      if (result.data.tone === "success") onDone?.();
    });

  if (linking && inSheet) {
    return (
      <LinkVariantForm
        jobId={job.id}
        line={linking}
        onCancel={() => setLinking(null)}
        onDone={() => {
          setLinking(null);
          onDone?.();
        }}
      />
    );
  }

  const unmapped = job.code === "shopify_variant_unmapped" ? job.unmappedLines : [];

  return (
    <div className="flex flex-col gap-4">
      {open && !confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button pending={retrying} pendingLabel="Retrying…" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : null}

      {open && unmapped.length > 0 && !confirming ? (
        <ul aria-label="Lines BICII does not know" className="flex flex-col gap-3">
          {unmapped.map((line, i) => (
            <li
              key={`${line.lineItemId ?? "line"}-${i}`}
              className="flex flex-col gap-2 rounded-xl border border-hairline p-3"
            >
              <span className="font-medium break-words">{unmappedLineTitle(line)}</span>
              {line.variantGid ? (
                <>
                  <span className="font-mono text-xs break-all text-dust-700">
                    {line.variantGid}
                  </span>
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Link to a BICII product: ${unmappedLineTitle(line)}`}
                      onClick={() => setLinking(line)}
                    >
                      Link to a BICII product
                    </Button>
                  </div>
                </>
              ) : (
                <span className="text-sm text-dust-700">
                  Custom Shopify line — record it by hand if needed, then dismiss
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <ReasonConfirm
          startLabel="Dismiss…"
          question="Why are you dismissing it?"
          hint="Staff see this reason in the event's history."
          confirmLabel="Dismiss"
          pendingLabel="Dismissing…"
          failureTitle="Not dismissed"
          successTitle="Dismissed"
          onConfirmingChange={setConfirming}
          onConfirm={(reason) => dismissJobAction({ jobId: job.id, reason })}
          onDone={onDone}
        >
          {isOrder
            ? "Nothing is recorded in BICII. Waiting refunds of this order are closed too. If the customer should not have paid, refund them in Shopify."
            : "Nothing is recorded in BICII for it."}
        </ReasonConfirm>
      ) : null}

      {showOpenEvent && job.eventId ? (
        <Link
          href={`/shopify/events/${job.eventId}`}
          className="inline-flex min-h-tap items-center text-sm font-semibold underline underline-offset-4"
        >
          Open event
        </Link>
      ) : null}

      {!inSheet ? (
        <LinkVariantSheet
          jobId={job.id}
          line={linking}
          onOpenChange={(o) => {
            if (!o) setLinking(null);
          }}
          onDone={() => {
            setLinking(null);
            onDone?.();
          }}
        />
      ) : null}
    </div>
  );
}

/** The product picker for linking (staff_search over products; admins). */
export function ProductLinkPicker({
  value,
  onSelect,
}: {
  value: PickerOption | null;
  onSelect: (option: PickerOption | null) => void;
}) {
  const search = async (q: string): Promise<PickerOption[]> => {
    const result = await searchProductsForLinkAction({ q });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  };
  return (
    <SearchPicker
      search={search}
      value={value}
      onSelect={onSelect}
      required
      placeholder="Search name, SKU or P- number"
      minChars={2}
      debounceMs={250}
      emptyMessage="No product matches. Check the name or P- number."
    />
  );
}

/**
 * Link one Shopify line's variant to a BICII product (D84: mapping only;
 * the order is then retried). The line, its variant and product ids are
 * shown read-only; the product comes from the picker; a reason is required.
 */
export function LinkVariantForm({
  jobId,
  line,
  onCancel,
  onDone,
}: {
  jobId: string;
  line: UnmappedLine;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [product, setProduct] = useState<PickerOption | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const submit = () =>
    start(async () => {
      setError(null);
      const local: Record<string, string[]> = {};
      if (!product) local.productId = ["Choose the BICII product this Shopify line is."];
      if (!reason.trim()) local.reason = ["Say why this is the same product."];
      if (Object.keys(local).length > 0) {
        setErrors(local);
        return;
      }
      const result = await linkVariantAction({
        jobId,
        productId: product!.id,
        shopifyProductGid: line.productGid ?? "",
        shopifyVariantGid: line.variantGid ?? "",
        reason: reason.trim(),
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setError(result.error);
        return;
      }
      toast({
        title: result.data.title,
        description: result.data.description ?? undefined,
        tone: result.data.tone,
      });
      onDone();
    });

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) submit();
      }}
    >
      <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        Link to a BICII product
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-dust-500">Shopify line</dt>
        <dd className="font-medium break-words">{unmappedLineTitle(line)}</dd>
        <dt className="text-dust-500">Variant</dt>
        <dd className="font-mono text-xs break-all">{line.variantGid ?? "None"}</dd>
        <dt className="text-dust-500">Product</dt>
        <dd className="font-mono text-xs break-all">{line.productGid ?? "None"}</dd>
      </dl>
      {!line.productGid ? (
        <p className="text-sm text-danger-deep">
          Shopify sent no product for this line, so it cannot be linked. Record it by hand if
          needed, then dismiss.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger-deep">
          {error}
        </p>
      ) : null}
      <Field
        label="BICII product"
        hint="Later orders for this Shopify variant sell this product's stock."
        error={errors.productId?.[0]}
        required
      >
        <ProductLinkPicker
          value={product}
          onSelect={(o) => {
            setProduct(o);
            setErrors((e) => ({ ...e, productId: undefined }));
          }}
        />
      </Field>
      <Field label="Reason" error={errors.reason?.[0]} required>
        <Textarea
          name="reason"
          rows={2}
          maxLength={REASON_MAX_LENGTH}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setErrors((x) => ({ ...x, reason: undefined }));
          }}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Linking…"
          disabled={!line.productGid || !line.variantGid}
        >
          Link and retry
        </Button>
      </div>
    </form>
  );
}

/** LinkVariantForm in its own sheet (the event inspector). */
export function LinkVariantSheet({
  jobId,
  line,
  onOpenChange,
  onDone,
}: {
  jobId: string;
  line: UnmappedLine | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <Sheet
      open={line !== null}
      onOpenChange={onOpenChange}
      title={line ? `Link “${unmappedLineTitle(line)}”` : "Link to a BICII product"}
    >
      {line ? (
        <LinkVariantForm
          jobId={jobId}
          line={line}
          onCancel={() => onOpenChange(false)}
          onDone={onDone}
        />
      ) : null}
    </Sheet>
  );
}
