"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Spinner } from "@/components/ui/spinner";
import { reconciliationHref } from "@/lib/reconciliation";

/**
 * "Problems only" (the default) or "Everything" on /reports/reconciliation,
 * kept in the URL as `all=1` with the product filter left as it is.
 */
export function ReconciliationScope({
  all,
  productId,
}: {
  all: boolean;
  productId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl<"issues" | "all">
        label="Show"
        options={[
          { value: "issues", label: "Problems only" },
          { value: "all", label: "Everything" },
        ]}
        value={all ? "all" : "issues"}
        onValueChange={(v) =>
          startTransition(() => {
            router.replace(reconciliationHref({ all: v === "all", productId }), {
              scroll: false,
            });
          })
        }
      />
      {pending ? <Spinner label="Loading" className="size-4 text-dust-500" /> : null}
    </div>
  );
}
