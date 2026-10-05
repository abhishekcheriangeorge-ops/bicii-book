import { StatusPill } from "@/components/ui/status-pill";
import {
  purchaseOrderStatusLabel,
  purchaseOrderStatusTone,
  type PurchaseOrderStatus,
} from "@/lib/purchasing";

/** A purchase order's status as a pill: tone and words (never colour alone). */
export function PurchaseOrderStatusPill({
  status,
  className,
}: {
  status: PurchaseOrderStatus;
  className?: string;
}) {
  return (
    <StatusPill status={purchaseOrderStatusTone(status)} className={className}>
      {purchaseOrderStatusLabel(status)}
    </StatusPill>
  );
}
